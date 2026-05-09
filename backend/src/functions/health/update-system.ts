import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { updateHealthSchema } from "../../validation/health-schema.js";
import { hasPermission, isSuperAdmin } from "../../utils/rbac.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { rejectIfDemo } from "../../utils/actor-auth.js";
import { resolveDeploymentMode } from "../../utils/health-workflow.js";
import { DEMO_ORG_ID } from "../../types/organization.js";

const effectiveOrgId = (orgId?: unknown): string =>
  typeof orgId === "string" && orgId.length > 0 ? orgId : DEMO_ORG_ID;

interface UpdateSystemBody {
  name?: string;
  url?: string;
  deploymentMode?: "auto" | "render" | "standard";
}

/**
 * Edit an existing system's metadata. Only the fields actually
 * provided in the body are updated. Permission-gated on
 * `canUpdateSystem`; org-scoped to the actor's org.
 */
export const updateSystem = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.SYSTEM_PULSE_TABLE;
    const usersTable = process.env.USERS_TABLE;

    if (!tableName || !usersTable) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          message: "SYSTEM_PULSE_TABLE or USERS_TABLE not set",
        }),
      };
    }

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "systems-update",
      limit: 30,
      windowSeconds: 60,
    });

    const systemId = event.pathParameters?.id;
    if (!systemId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "system id required" }),
      };
    }

    const body = parse(event.body) as Record<string, unknown>;
    const validated = (await updateHealthSchema.validate(body, {
      stripUnknown: true,
    })) as UpdateSystemBody;

    const actorUserId =
      (event.headers["x-user-id"] as string) ||
      (event.headers["X-User-Id"] as string) ||
      "";

    const actorResponse: any = await docClient.send(
      new GetCommand({
        TableName: usersTable,
        Key: { PK: "USER", SK: `USER#${actorUserId}` },
      }),
    );
    const actor = actorResponse.Item || {};

    if (actor.status_ !== "Active") {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: "forbidden - actor is not active" }),
      };
    }
    rejectIfDemo(actor as any);

    if (!hasPermission(actor as any, "canUpdateSystem")) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message:
            "forbidden - your account does not have the canUpdateSystem permission",
        }),
      };
    }

    const systemResponse: any = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: "SYSTEM", SK: `SYS#${systemId}` },
      }),
    );
    const system = systemResponse.Item;
    if (!system) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "system not found" }),
      };
    }

    if (!isSuperAdmin(actor.role as any)) {
      const actorOrgId = actor.orgId || DEMO_ORG_ID;
      if (effectiveOrgId(system.orgId) !== actorOrgId) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - out of org scope" }),
        };
      }
    }

    const updates: string[] = [];
    const values: Record<string, unknown> = {};
    const names: Record<string, string> = {};

    if (typeof validated.name === "string" && validated.name.length > 0) {
      updates.push("#name = :name");
      values[":name"] = validated.name;
      names["#name"] = "name";
    }
    if (typeof validated.url === "string" && validated.url.length > 0) {
      updates.push("#url = :url");
      values[":url"] = validated.url;
      names["#url"] = "url";
    }
    if (validated.deploymentMode) {
      const resolved = resolveDeploymentMode(
        validated.url || system.url,
        validated.deploymentMode,
      );
      updates.push("deploymentMode = :mode");
      values[":mode"] = resolved;
    }

    if (updates.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "no updatable fields provided" }),
      };
    }

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: "SYSTEM", SK: `SYS#${systemId}` },
        UpdateExpression: `SET ${updates.join(", ")}`,
        ExpressionAttributeValues: values,
        ...(Object.keys(names).length > 0
          ? { ExpressionAttributeNames: names }
          : {}),
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "System updated",
        data: { systemId },
      }),
    };
  } catch (error) {
    console.error("update-system error:", error);
    return handleError(error);
  }
};
