import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import {
  canInviteRole,
  isAdminOrSuper,
  isSuperAdmin,
} from "../../utils/rbac.js";
import { DEMO_ORG_ID } from "../../types/organization.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { resolvePermissions } from "../../types/user.js";

const effectiveOrgId = (orgId?: unknown): string =>
  typeof orgId === "string" && orgId.length > 0 ? orgId : DEMO_ORG_ID;

export const listUsers = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.USERS_TABLE;

    if (!tableName) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: "USERS_TABLE not set" }),
      };
    }

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "users-list",
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

    if (!isAdminOrSuper(inviterRole as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: "forbidden" }),
      };
    }

    // Resolve actor's org from DB.
    let actorOrgId: string | undefined;
    let actorRole = inviterRole;
    if (userId) {
      try {
        const actorResponse: any = await docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { PK: "USER", SK: `USER#${userId}` },
          }),
        );
        const u = actorResponse.Item || {};
        actorOrgId = u.orgId as string | undefined;
        actorRole = (u.role as string | undefined) || actorRole;
      } catch {}
    }

    const limit = Number(event.queryStringParameters?.limit || 100);

    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "EntityTypeIndex",
        KeyConditionExpression: "entityType = :entityType",
        ExpressionAttributeValues: {
          ":entityType": "USER",
        },
        ScanIndexForward: false,
        Limit: Math.max(1, Math.min(limit, 200)),
      }),
    );

    const scopedOrgId = isSuperAdmin(actorRole as any)
      ? null
      : actorOrgId || DEMO_ORG_ID;

    const users = (result.Items || [])
      .filter((item) => String(item.SK || "").startsWith("USER#"))
      // Hide ephemeral demo session accounts from regular admin lists.
      .filter((item) => !item.demoMode)
      .filter((item) => canInviteRole(actorRole as any, item.role as any))
      .filter((item) =>
        scopedOrgId === null ? true : effectiveOrgId(item.orgId) === scopedOrgId,
      )
      .map((item) => ({
        id: item.id,
        email: item.email,
        full_name: item.full_name,
        role: item.role,
        status_: item.status_,
        createDate: item.createDate,
        allowedSystemIds: Array.isArray(item.allowedSystemIds)
          ? item.allowedSystemIds
          : [],
        orgId: effectiveOrgId(item.orgId),
        permissions: resolvePermissions(item as any),
        lockedAt: typeof item.lockedAt === "string" ? item.lockedAt : null,
        failedLoginAttempts: Number(item.failedLoginAttempts || 0),
      }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        data: {
          users,
          count: users.length,
        },
      }),
    };
  } catch (error) {
    console.error("list-users error:", error);
    return handleError(error);
  }
};
