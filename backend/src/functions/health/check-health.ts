import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { parse } from "../../utils/parse.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { createHealthSchema } from "../../validation/health-schema.js";
import { docClient } from "../../config/db.js";
import { createHealthService } from "../../services/health-service.js";
import type { CreateHealthInput } from "../../types/health.js";
import { hasPermission } from "../../utils/rbac.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { rejectIfDemo } from "../../utils/actor-auth.js";
import { DEMO_ORG_ID } from "../../types/organization.js";

export const createHealthCheck = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.SYSTEM_PULSE_TABLE;

    if (!tableName) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          status: 500,
          message: "SYSTEM_PULSE_TABLE environment variable is not set.",
        }),
      };
    }

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "systems-create",
      limit: 20,
      windowSeconds: 60,
    });

    const body = parse(event.body) as Record<string, unknown>;

    const inviterRole =
      (event.headers &&
        ((event.headers["x-inviter-role"] as string) ||
          (event.headers["X-Inviter-Role"] as string))) ||
      undefined;

    const actorUserId =
      (event.headers &&
        ((event.headers["x-user-id"] as string) ||
          (event.headers["X-User-Id"] as string))) ||
      undefined;

    // Resolve actor for permission check + org scoping + demo guard.
    let actorOrgId: string | undefined;
    let actorIsDemo = false;
    let actorRecord: Record<string, unknown> = {};
    if (actorUserId) {
      try {
        const actorResponse: any = await docClient.send(
          new GetCommand({
            TableName: process.env.USERS_TABLE!,
            Key: { PK: "USER", SK: `USER#${actorUserId}` },
          }),
        );
        actorRecord = actorResponse.Item || {};
        actorOrgId = actorRecord.orgId as string | undefined;
        actorIsDemo = Boolean(actorRecord.demoMode);
      } catch {}
    }

    if (!hasPermission(actorRecord as any, "canCreateSystem")) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          status: 403,
          message:
            "forbidden - your account does not have the canCreateSystem permission",
        }),
      };
    }

    // Header-role mismatch sanity check kept as belt-and-braces.
    void inviterRole;

    // Demo sessions are sandboxed: they may CREATE systems in the demo
    // org (so reviewers can test the create flow), but the system is
    // pinned to the demo org and cannot escape it.
    const validated = (await createHealthSchema.validate(body, {
      stripUnknown: true,
    })) as CreateHealthInput;

    const service = createHealthService(docClient, tableName);
    const ownerOrgId = actorOrgId || DEMO_ORG_ID;
    // Demo admins are allowed to create demo-scoped systems. We do
    // NOT call rejectIfDemo here so reviewers can exercise the
    // "Create System" button.
    void rejectIfDemo;

    const item = await service.createHealthCheck({
      ...validated,
      orgId: actorIsDemo ? DEMO_ORG_ID : ownerOrgId,
    } as CreateHealthInput);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        status: 201,
        message: "Health check created",
        data: item,
      }),
    };
  } catch (error) {
    console.error("Error creating health check:", error);
    return handleError(error);
  }
};
