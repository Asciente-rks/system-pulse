import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { parse } from "../../utils/parse.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { createUserSchema } from "../../validation/user-validation.js";
import { docClient } from "../../config/db.js";
import { createUserService } from "../../services/user-service.js";
import {
  canInviteRole,
  hasPermission,
  isAdminOrSuper,
  isOwner,
} from "../../utils/rbac.js";
import {
  PERMISSION_KEYS,
  resolvePermissions,
  type CreateUserInput,
  type UserPermissions,
} from "../../types/user.js";
import { sendInviteEmail } from "../../services/email-service.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { resolveFrontendBaseUrl } from "../../utils/frontend-url.js";
import { rejectIfDemo } from "../../utils/actor-auth.js";
import { DEMO_ORG_ID } from "../../types/organization.js";

export const createUserInvitation = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.USERS_TABLE;

    if (!tableName) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          status: 500,
          message: "USERS_TABLE environment variable is not set.",
        }),
      };
    }

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "users-invite",
      limit: 20,
      windowSeconds: 60,
    });

    const body = parse(event.body) as Record<string, unknown>;
    const validated = (await createUserSchema.validate(body, {
      stripUnknown: true,
    })) as CreateUserInput;

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

    if (!canInviteRole(inviterRole as any, validated.role)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          status: 403,
          message: "forbidden - insufficient role to invite this user",
        }),
      };
    }

    const attemptedSetStatus = Object.prototype.hasOwnProperty.call(
      body,
      "status_",
    );
    if (attemptedSetStatus && !isAdminOrSuper(inviterRole as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          status: 403,
          message: "forbidden - only admin or superadmin can set status",
        }),
      };
    }

    // Resolve actor for org scoping + demo guard + permission check.
    let actorOrgId: string | undefined;
    let actorRecord: Record<string, unknown> = {};
    if (actorUserId) {
      try {
        const actorResponse = await docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { PK: "USER", SK: `USER#${actorUserId}` },
          }),
        );
        actorRecord = (actorResponse.Item as Record<string, unknown>) || {};
        actorOrgId = (actorRecord.orgId as string | undefined) || undefined;
      } catch {}
    }

    // Demo sessions cannot persist new invitations into the platform.
    rejectIfDemo(actorRecord as any);

    // Permission gate (authoritative).
    if (!hasPermission(actorRecord as any, "canCreateUser")) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          status: 403,
          message:
            "forbidden - your account does not have the canCreateUser permission",
        }),
      };
    }

    // Only owners can mint other admins. Plain admins can invite
    // user-tier accounts only.
    if (validated.role === "admin" && !isOwner(actorRecord.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          status: 403,
          message: "forbidden - only the org owner can create admin accounts",
        }),
      };
    }

    // Permissions whitelist on the inviter side. Only the owner can
    // grant elevated permissions; admins can grant a subset.
    const requestedPermissions = (body.permissions || {}) as Partial<
      UserPermissions
    >;
    const actorIsOwner = isOwner(actorRecord.role as any);
    const filteredPermissions: Partial<UserPermissions> = {};
    for (const key of PERMISSION_KEYS) {
      if (typeof requestedPermissions[key] !== "boolean") continue;
      if (
        !actorIsOwner &&
        (key === "canDeleteUser" ||
          key === "canDeleteSystem" ||
          key === "canUpdateUser")
      ) {
        // Plain admins cannot grant the dangerous permissions on
        // creation. They can still flip view/trigger flags off.
        continue;
      }
      filteredPermissions[key] = requestedPermissions[key];
    }

    const service = createUserService(docClient, tableName);
    const orgIdForNewUser = actorOrgId || DEMO_ORG_ID;

    const { user, inviteToken, inviteEligibilityExpiresAt } =
      await service.createUserInvitation({
        ...validated,
        orgId: orgIdForNewUser,
        permissions: filteredPermissions,
      });
    void resolvePermissions; // referenced for tree-shake hint

    const frontend = resolveFrontendBaseUrl(event.headers);
    const inviteLink = `${frontend}/accept-invite?token=${inviteToken}`;
    let emailSent = false;

    try {
      await sendInviteEmail({
        to: user.email,
        inviteLink,
        invitedName: user.full_name,
        invitedRole: user.role,
        eligibilityExpiresAt: inviteEligibilityExpiresAt,
      });
      emailSent = true;
    } catch (mailError) {
      console.error("Invite email send failed:", mailError);
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        status: 201,
        message: emailSent
          ? "User invited successfully and email sent"
          : "User invited successfully. Email delivery is not configured or failed.",
        data: user,
        inviteEligibilityExpiresAt,
        inviteLink:
          process.env.SHOW_INVITE_LINK === "true" ? inviteLink : undefined,
      }),
    };
  } catch (error) {
    console.error("Error creating user:", error);
    return handleError(error);
  }
};
