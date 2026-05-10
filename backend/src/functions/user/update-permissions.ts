import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import {
  PERMISSION_KEYS,
  USER_STATUSES,
  type UserPermissions,
} from "../../types/user.js";
import { sendStatusChangeEmail } from "../../services/email-service.js";
import {
  canSeeOrg,
  hasPermission,
  isOwner,
  isSuperAdmin,
} from "../../utils/rbac.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { rejectIfDemo } from "../../utils/actor-auth.js";
import { DEMO_ORG_ID } from "../../types/organization.js";

const effectiveOrgId = (orgId?: unknown): string =>
  typeof orgId === "string" && orgId.length > 0 ? orgId : DEMO_ORG_ID;

/**
 * PATCH a user's permissions, allowed system list, and/or status in
 * one shot. Owners can flip any permission for any non-owner member;
 * plain admins are restricted from granting elevated perms
 * (canDeleteUser, canDeleteSystem, canUpdateUser).
 */
export const updateUserPermissions = async (
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
      key: "users-update-permissions",
      limit: 30,
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

    // Superadmins are platform-level and can never be edited via
    // this endpoint. Owners are normally protected too — except when
    // the actor is themselves a superadmin, in which case they can
    // suspend / reactivate / adjust permissions on owners (e.g. to
    // disable a misbehaving org without deleting it).
    if (target.role === "superadmin") {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message: "forbidden - cannot edit superadmin via permission update",
        }),
      };
    }
    if (target.role === "owner" && !isSuperAdmin(actor.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message:
            "forbidden - only superadmin can edit org owners",
        }),
      };
    }

    const actorIsOwner = isOwner(actor.role as any);

    // Read out the bits we care about.
    const requestedPermissions = (body.permissions || {}) as Partial<
      UserPermissions
    >;
    const systemIds = Array.isArray(body.systemIds)
      ? (body.systemIds as string[])
      : undefined;
    const requestedStatus =
      typeof body.status_ === "string" ? body.status_ : undefined;
    // Optional moderator metadata accompanying a status change.
    const reason =
      typeof body.reason === "string" ? body.reason.trim() : undefined;
    const notes =
      typeof body.notes === "string" ? body.notes.trim() : undefined;

    if (
      requestedStatus &&
      !USER_STATUSES.includes(
        requestedStatus as (typeof USER_STATUSES)[number],
      )
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: `status_ must be one of: ${USER_STATUSES.join(", ")}`,
        }),
      };
    }

    if (systemIds) {
      if (systemIds.length > 500) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            message: "systemIds may contain at most 500 ids",
          }),
        };
      }
      if (
        !systemIds.every(
          (id) => typeof id === "string" && id.length > 0 && id.length < 200,
        )
      ) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            message: "systemIds must be non-empty short strings",
          }),
        };
      }
    }

    const filteredPermissions: Partial<UserPermissions> = {};
    for (const key of PERMISSION_KEYS) {
      if (typeof requestedPermissions[key] !== "boolean") continue;
      if (
        !actorIsOwner &&
        (key === "canDeleteUser" ||
          key === "canDeleteSystem" ||
          key === "canUpdateUser")
      ) {
        continue;
      }
      filteredPermissions[key] = requestedPermissions[key];
    }

    const updates: string[] = [];
    const values: Record<string, unknown> = {};
    const names: Record<string, string> = {};

    if (systemIds) {
      updates.push("allowedSystemIds = :systems");
      values[":systems"] = systemIds;
    }
    if (requestedStatus) {
      updates.push("#status = :status");
      values[":status"] = requestedStatus;
      names["#status"] = "status_";
      // When suspending, persist the moderator metadata so the
      // platform owner can audit later.
      if (requestedStatus === "Suspended") {
        if (reason) {
          updates.push("suspendedReason = :reason");
          values[":reason"] = reason;
        }
        if (notes !== undefined) {
          updates.push("suspendedNotes = :notes");
          values[":notes"] = notes;
        }
        updates.push("suspendedAt = :ts");
        values[":ts"] = new Date().toISOString();
      } else {
        // Returning to Active clears the metadata.
        updates.push("#suspendedReason = :clearStr");
        names["#suspendedReason"] = "suspendedReason";
        updates.push("#suspendedNotes = :clearStr");
        names["#suspendedNotes"] = "suspendedNotes";
        values[":clearStr"] = "";
      }
    }

    if (Object.keys(filteredPermissions).length > 0) {
      // Merge new permissions with whatever was already stored, so a
      // partial update doesn't blast unrelated keys.
      const existing = (target.permissions || {}) as Partial<UserPermissions>;
      const merged = { ...existing, ...filteredPermissions };
      updates.push("#permissions = :permissions");
      values[":permissions"] = merged;
      names["#permissions"] = "permissions";
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
        Key: { PK: "USER", SK: `USER#${targetUserId}` },
        UpdateExpression: `SET ${updates.join(", ")}`,
        ExpressionAttributeValues: values,
        ...(Object.keys(names).length > 0
          ? { ExpressionAttributeNames: names }
          : {}),
      }),
    );

    // Status-change notification email (best-effort).
    if (
      requestedStatus &&
      requestedStatus !== target.status_ &&
      target.email
    ) {
      try {
        let orgName: string | undefined;
        if (target.orgId) {
          try {
            const orgResp: any = await docClient.send(
              new (await import("@aws-sdk/lib-dynamodb")).GetCommand({
                TableName: tableName,
                Key: { PK: "ORG", SK: `ORG#${target.orgId}` },
              }),
            );
            orgName = (orgResp.Item as { name?: string } | undefined)?.name;
          } catch {}
        }
        if (requestedStatus === "Suspended") {
          await sendStatusChangeEmail({
            to: target.email,
            recipientName: target.full_name || "there",
            actorName: (actor as any).full_name,
            orgName,
            subjectKind: "account",
            reason: reason || "Status change",
            notes,
            action: "suspended",
          });
        } else if (
          requestedStatus === "Active" &&
          target.status_ === "Suspended"
        ) {
          await sendStatusChangeEmail({
            to: target.email,
            recipientName: target.full_name || "there",
            actorName: (actor as any).full_name,
            orgName,
            subjectKind: "account",
            reason: "Reactivated",
            notes,
            action: "reactivated",
            loginLink: `${process.env.FRONTEND_URL || ""}/login`,
          });
        }
      } catch (mailErr) {
        console.warn("update-permissions email send failed:", mailErr);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "User updated",
        data: {
          userId: targetUserId,
          systemIds,
          status_: requestedStatus,
          permissions: filteredPermissions,
        },
      }),
    };
  } catch (error) {
    console.error("update-permissions error:", error);
    return handleError(error);
  }
};
