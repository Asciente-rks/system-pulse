import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import {
  DEFAULT_PERMISSIONS_BY_ROLE,
  USER_ROLES,
  type UserRole,
} from "../../types/user.js";
import { canChangeRole, canSeeOrg, isOwner } from "../../utils/rbac.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { rejectIfDemo } from "../../utils/actor-auth.js";
import { DEMO_ORG_ID } from "../../types/organization.js";

const effectiveOrgId = (orgId?: unknown): string =>
  typeof orgId === "string" && orgId.length > 0 ? orgId : DEMO_ORG_ID;

// The roles an org owner is allowed to assign to other members.
// Cannot promote anyone to `owner` here — that requires a separate
// transfer-ownership flow we haven't built yet.
const ASSIGNABLE_ROLES: UserRole[] = ["admin", "user", "tester"];

/**
 * Promote / demote a user within the actor's org. Owner-only.
 *
 *   POST /users/:id/role  body: { role: "admin" | "user" | "tester" }
 *
 * Promoting → grants the role's default permission set.
 * Demoting  → also resets to the lower role's defaults.
 * The actor cannot demote themselves.
 */
export const changeUserRole = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.USERS_TABLE;
    if (!tableName)
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: "USERS_TABLE not set" }),
      };

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "users-change-role",
      limit: 20,
      windowSeconds: 60,
    });

    const targetUserId = event.pathParameters?.id;
    if (!targetUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "user id required" }),
      };
    }

    const body = (parse(event.body) as Record<string, unknown>) || {};
    const newRole = body.role as UserRole | undefined;
    if (!newRole || !USER_ROLES.includes(newRole)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: `role must be one of: ${ASSIGNABLE_ROLES.join(", ")}`,
        }),
      };
    }
    if (!ASSIGNABLE_ROLES.includes(newRole)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: `role '${newRole}' cannot be assigned via this endpoint`,
        }),
      };
    }

    const actorUserId =
      (event.headers["x-user-id"] as string) ||
      (event.headers["X-User-Id"] as string) ||
      "";

    const actorResponse: any = await docClient.send(
      new GetCommand({
        TableName: tableName,
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

    if (!isOwner(actor.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message: "forbidden - only the org owner can change user roles",
        }),
      };
    }

    if (actor.id === targetUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: "cannot change your own role",
        }),
      };
    }

    const targetResponse: any = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: "USER", SK: `USER#${targetUserId}` },
      }),
    );
    const target = targetResponse.Item;
    if (!target) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "user not found" }),
      };
    }

    if (
      !canSeeOrg(
        actor.role as any,
        actor.orgId,
        effectiveOrgId(target.orgId),
      )
    ) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: "forbidden - out of org scope" }),
      };
    }

    if (!canChangeRole(actor.role as any, target.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message: "forbidden - cannot change this user's role",
        }),
      };
    }

    const newPermissions = { ...DEFAULT_PERMISSIONS_BY_ROLE[newRole] };

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: "USER", SK: `USER#${targetUserId}` },
        UpdateExpression: "SET #role = :role, #permissions = :permissions",
        ExpressionAttributeNames: {
          "#role": "role",
          "#permissions": "permissions",
        },
        ExpressionAttributeValues: {
          ":role": newRole,
          ":permissions": newPermissions,
        },
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: `User role updated to ${newRole}`,
        data: {
          userId: targetUserId,
          role: newRole,
          permissions: newPermissions,
        },
      }),
    };
  } catch (error) {
    console.error("change-role error:", error);
    return handleError(error);
  }
};
