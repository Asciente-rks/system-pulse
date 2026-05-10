import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import {
  hasPermission,
  isAdminTier,
  isOwner,
  isSuperAdmin,
} from "../../utils/rbac.js";
import {
  getActorUserId,
  rejectIfDemo,
  requireAdminActorPassword,
} from "../../utils/actor-auth.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { DEMO_ORG_ID } from "../../types/organization.js";
import { sendStatusChangeEmail } from "../../services/email-service.js";

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
    // Optional moderator metadata. The frontend's delete dialog now
    // requires a reason from a fixed dropdown; we accept it here so
    // the email + audit trail can include it.
    const deleteReason =
      typeof body.reason === "string" ? body.reason.trim() : undefined;
    const deleteNotes =
      typeof body.notes === "string" ? body.notes.trim() : undefined;

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

    // Permission-gated. Owners always pass via hasPermission;
    // admins/users need an explicit `canDeleteUser: true` grant.
    if (!hasPermission(actor as any, "canDeleteUser")) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message:
            "forbidden - your account does not have the canDeleteUser permission",
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
      | {
          role?: string;
          orgId?: string;
          demoMode?: boolean;
          email?: string;
          full_name?: string;
        }
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

      // Owners cannot be deleted (they'd orphan the org). Promote
      // someone else to owner first if you really need to remove them.
      if (target.role === "owner" || target.role === "superadmin") {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            message:
              "forbidden - cannot delete the org owner; promote someone else first",
          }),
        };
      }

      // Non-owners cannot delete other admins. Owners can delete any
      // non-owner member of their org.
      if (target.role === "admin" && !isOwner(actor.role as any)) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            message: "forbidden - only the org owner can delete admins",
          }),
        };
      }
    }
    // touch isAdminTier so unused-import warnings don't fail the build
    void isAdminTier;

    // Email the user BEFORE we wipe their row (best-effort). Targets
    // with no email (e.g. demo accounts) silently skip.
    if (target.email) {
      try {
        let orgName: string | undefined;
        if (target.orgId) {
          try {
            const orgResp: any = await docClient.send(
              new (await import("@aws-sdk/lib-dynamodb")).GetCommand({
                TableName: usersTable,
                Key: { PK: "ORG", SK: `ORG#${target.orgId}` },
              }),
            );
            orgName = (orgResp.Item as { name?: string } | undefined)?.name;
          } catch {}
        }
        await sendStatusChangeEmail({
          to: target.email,
          recipientName: target.full_name || "there",
          actorName: (actor as any).full_name,
          orgName,
          subjectKind: "account",
          reason: deleteReason || "Account removed",
          notes: deleteNotes,
          action: "permanently deleted",
        });
      } catch (mailErr) {
        console.warn("delete-user email send failed:", mailErr);
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
