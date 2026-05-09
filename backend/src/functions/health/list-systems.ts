import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { isAdminOrSuper, isSuperAdmin } from "../../utils/rbac.js";
import { resolveDeploymentMode } from "../../utils/health-workflow.js";
import { DEMO_ORG_ID } from "../../types/organization.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";

type HealthSystemRecord = {
  id: string;
  name: string;
  url: string;
  deploymentMode: "render" | "standard";
  status?: "UP" | "DOWN" | "UNKNOWN";
  createDate: string;
  lastChecked?: string;
  lastResponseCode?: number;
  responseTimeMs?: number;
  orgId?: string;
};

/**
 * Treat any system without an orgId as belonging to the demo org.
 * This keeps backwards compatibility with the original single-tenant
 * data set (the platform owner's personal projects).
 */
const effectiveOrgId = (orgId?: unknown): string =>
  typeof orgId === "string" && orgId.length > 0 ? orgId : DEMO_ORG_ID;

export const listSystems = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.SYSTEM_PULSE_TABLE;

    if (!tableName) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: "SYSTEM_PULSE_TABLE not set" }),
      };
    }

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "systems-list",
      limit: 60,
      windowSeconds: 60,
    });

    const inviterRole =
      (event.headers &&
        ((event.headers["x-inviter-role"] as string) ||
          (event.headers["X-Inviter-Role"] as string))) ||
      undefined;

    const userId =
      (event.headers &&
        ((event.headers["x-user-id"] as string) ||
          (event.headers["X-User-Id"] as string))) ||
      undefined;

    const limit = Number(event.queryStringParameters?.limit || 100);

    const systemsResponse = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": "SYSTEM",
          ":skPrefix": "SYS#",
        },
        ScanIndexForward: false,
        Limit: Math.max(1, Math.min(limit, 200)),
      }),
    );

    let systems = (systemsResponse.Items || []).map((item) => ({
      id: item.id,
      name: item.name,
      url: item.url,
      deploymentMode: resolveDeploymentMode(item.url, item.deploymentMode),
      status: item.status,
      createDate: item.createDate,
      lastChecked: item.lastChecked,
      lastResponseCode: item.lastResponseCode,
      responseTimeMs: item.responseTimeMs,
      orgId: effectiveOrgId(item.orgId),
    })) as HealthSystemRecord[];

    // Resolve actor for org scoping. Headers are advisory; the DB
    // record is the source of truth.
    let actorOrgId: string | undefined;
    let actorRole: string | undefined = inviterRole;
    let actorAllowedSystems: string[] = [];
    let actorIsActive = true;

    if (userId) {
      try {
        const userResponse: any = await docClient.send(
          new GetCommand({
            TableName: process.env.USERS_TABLE!,
            Key: { PK: "USER", SK: `USER#${userId}` },
          }),
        );
        const u = userResponse.Item || {};
        actorOrgId = u.orgId as string | undefined;
        actorRole = (u.role as string | undefined) || actorRole;
        actorAllowedSystems = Array.isArray(u.allowedSystemIds)
          ? u.allowedSystemIds
          : [];
        actorIsActive = u.status_ === "Active";
      } catch (lookupError) {
        console.warn("list-systems: actor lookup failed", lookupError);
      }
    }

    if (!isAdminOrSuper(actorRole as any)) {
      if (!userId) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - user id required" }),
        };
      }

      if (!actorIsActive) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - user is not active" }),
        };
      }

      // Org members see only systems within their org AND that they have
      // been explicitly granted access to. Demo `user` role implicitly
      // gets access to every demo system (it's a sandbox).
      const scopedOrgId = actorOrgId || DEMO_ORG_ID;
      systems = systems.filter((system) => system.orgId === scopedOrgId);

      if (scopedOrgId !== DEMO_ORG_ID) {
        systems = systems.filter((system) =>
          actorAllowedSystems.includes(system.id),
        );
      }
    } else if (!isSuperAdmin(actorRole as any)) {
      // Plain admin: scoped to own org. Demo admins see only the demo org.
      const scopedOrgId = actorOrgId || DEMO_ORG_ID;
      systems = systems.filter((system) => system.orgId === scopedOrgId);
    }
    // Superadmin: cross-org visibility, no filter.

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        data: {
          systems,
          count: systems.length,
        },
      }),
    };
  } catch (error) {
    console.error("list-systems error:", error);
    return handleError(error);
  }
};
