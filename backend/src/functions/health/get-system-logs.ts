import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { createHealthService } from "../../services/health-service.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { isAdminOrSuper, isSuperAdmin } from "../../utils/rbac.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { DEMO_ORG_ID } from "../../types/organization.js";

const effectiveOrgId = (orgId?: unknown): string =>
  typeof orgId === "string" && orgId.length > 0 ? orgId : DEMO_ORG_ID;

export const getSystemLogs = async (
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
      key: "systems-logs",
      limit: 60,
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

    // Resolve actor's org from DB.
    let actorOrgId: string | undefined;
    let actorRole = inviterRole;
    let actorAllowed: string[] = [];
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
        actorAllowed = Array.isArray(u.allowedSystemIds)
          ? u.allowedSystemIds
          : [];
        actorIsActive = u.status_ === "Active";
      } catch {}
    }

    // Resolve the system to get its org for cross-tenant checks.
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

    const systemOrgId = effectiveOrgId(system.orgId);

    if (!isSuperAdmin(actorRole as any)) {
      const scopedOrgId = actorOrgId || DEMO_ORG_ID;
      if (systemOrgId !== scopedOrgId) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - out of org scope" }),
        };
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

      // Demo org users implicitly get full access to all demo systems.
      const isDemoOrgViewer = systemOrgId === DEMO_ORG_ID;
      if (!isDemoOrgViewer && !actorAllowed.includes(systemId)) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - no access to logs" }),
        };
      }
    }

    const limit = Number(event.queryStringParameters?.limit || 20);
    const service = createHealthService(docClient, tableName);
    const logs = await service.listHealthLogs(systemId, limit);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        data: {
          systemId,
          logs,
        },
      }),
    };
  } catch (error) {
    console.error("get-system-logs error:", error);
    return handleError(error);
  }
};
