import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { parse } from "../../utils/parse.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { createUserSchema } from "../../validation/user-validation.js"; // You'll need this!
import { docClient } from "../../config/db.js"; // Use the shared connection
import { createUserService } from "../../services/user-service.js";
import { canInviteRole, isAdminOrSuper } from "../../utils/rbac.js";
import type { CreateUserInput } from "../../types/user.js";
import { sendInviteEmail } from "../../services/email-service.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";

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

    const service = createUserService(docClient, tableName);
    const { user, inviteToken, inviteEligibilityExpiresAt } =
      await service.createUserInvitation(validated);

    const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
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
    return handleError(error); // Uses the shared error handler
  }
};
