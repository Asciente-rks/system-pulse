import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { isAdminOrSuper, isSuperAdmin } from "../../utils/rbac.js";
import {
  getActorUserId,
  rejectIfDemo,
  requireAdminActorPassword,
} from "../../utils/actor-auth.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { DEMO_ORG_ID } from "../../types/organization.js";

const effectiveOrgId = (orgId?: unknown): string =>
  typeof orgId === "string" && orgId.length > 0 ? orgId : DEMO_ORG_ID;

export const deleteUser = async (
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
      key: "delete-user",
      limit: 10,
      windowSeconds: 60,
    });

    const body = (parse(event.body) as Record<string, unknown>) || {};
    const targetUserId =
      event.pathParameters?.id || (body.userId as string | undefined);
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

    // Demo sessions are blocked from deleting users — even admins of
    // the demo org. The platform owner remains the only one who can
    // permanently destroy accounts.
    rejectIfDemo(actor as any);

    // Org admins may delete users WITHIN their own org. Superadmins
    // may delete any user. We loosen the original superadmin-only
    // gate now that deletion is org-scoped.
    if (!isAdminOrSuper(actor.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message: "forbidden - admin or superadmin required",
        }),
      };
    }

    if (actor.id === targetUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "cannot delete your own account" }),
      };
    }

    const targetResponse = await docClient.send(
      new GetCommand({
        TableName: usersTable,
        Key: { PK: "USER", SK: `USER#${targetUserId}` },
      }),
    );

    const target = targetResponse.Item as
      | { role?: string; orgId?: string; demoMode?: boolean }
      | undefined;

    if (!target) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "user not found" }),
      };
    }

    // Org-isolation: a plain admin can ONLY delete users in their own
    // org. Superadmin is unrestricted.
    if (!isSuperAdmin(actor.role as any)) {
      const actorOrgId = actor.orgId || DEMO_ORG_ID;
      const targetOrgId = effectiveOrgId(target.orgId);
      if (actorOrgId !== targetOrgId) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            message: "forbidden - cannot delete users outside your organization",
          }),
        };
      }

      // Plain admins are NOT allowed to delete other admins, only org
      // members. (Prevents an admin booting another admin in the same org.)
      if (target.role === "admin" || target.role === "superadmin") {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            message: "forbidden - cannot delete admin or superadmin",
          }),
        };
      }
    }

    await docClient.send(
      new DeleteCommand({
        TableName: usersTable,
        Key: { PK: "USER", SK: `USER#${targetUserId}` },
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "User deleted",
        data: { userId: targetUserId },
      }),
    };
  } catch (error) {
    console.error("delete-user error:", error);
    return handleError(error);
  }
};
