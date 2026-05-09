import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import {
  hasPermission,
  canSeeOrg,
  isSuperAdmin,
} from "../../utils/rbac.js";
import {
  getActorUserId,
  rejectIfDemo,
  requireAdminActorPassword,
} from "../../utils/actor-auth.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { DEMO_ORG_ID } from "../../types/organization.js";

const effectiveOrgId = (orgId?: unknown): string =>
  typeof orgId === "string" && orgId.length > 0 ? orgId : DEMO_ORG_ID;

/**
 * Clear a user's failed-login lockout. Requires:
 *   - actor is admin/owner with `canUpdateUser` permission
 *   - actor's own password to confirm (same gate as deletion uses)
 *   - target is in the actor's org (superadmin can cross-org)
 *
 * Body: { actorPassword: string }
 */
export const unlockUser = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const usersTable = process.env.USERS_TABLE;
    if (!usersTable) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: "USERS_TABLE not set" }),
      };
    }

    await enforceRateLimit({
      docClient,
      tableName: usersTable,
      event,
      key: "users-unlock",
      limit: 20,
      windowSeconds: 60,
    });

    const body = (parse(event.body) as Record<string, unknown>) || {};
    const targetUserId = event.pathParameters?.id;
    const actorPassword = String(body.actorPassword || "");

    if (!targetUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "user id required" }),
      };
    }

    const actorUserId = getActorUserId(event);
    const actor = await requireAdminActorPassword(
      docClient,
      usersTable,
      actorUserId,
      actorPassword,
    );
    rejectIfDemo(actor as any);

    if (!hasPermission(actor as any, "canUpdateUser")) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message:
            "forbidden - your account does not have the canUpdateUser permission",
        }),
      };
    }

    const targetResponse: any = await docClient.send(
      new GetCommand({
        TableName: usersTable,
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
      !isSuperAdmin(actor.role as any) &&
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

    await docClient.send(
      new UpdateCommand({
        TableName: usersTable,
        Key: { PK: "USER", SK: `USER#${targetUserId}` },
        UpdateExpression:
          "SET failedLoginAttempts = :zero REMOVE lockedAt",
        ExpressionAttributeValues: { ":zero": 0 },
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "Account unlocked",
        data: { userId: targetUserId },
      }),
    };
  } catch (error) {
    console.error("unlock-user error:", error);
    return handleError(error);
  }
};
