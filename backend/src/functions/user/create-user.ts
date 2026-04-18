import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { parse } from "../../utils/parse.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { createUserSchema } from "../../validation/user-validation.js"; // You'll need this!
import { docClient } from "../../config/db.js"; // Use the shared connection
import { createUserService } from "../../services/user-service.js";
import { canInviteRole } from "../../utils/rbac.js";
import type { CreateUserInput } from "../../types/user.js";

export const createUserInvitation = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.USERS_TABLE;

    // 1. Environmental Check (Senior Move)
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

    // 2. Parse and Validate (The QA Step)
    const body = parse(event.body) as Record<string, unknown>;
    const validated = (await createUserSchema.validate(body, {
      stripUnknown: true, // This removes extra junk people try to send
    })) as CreateUserInput;

    // 3. Authorization check
    const inviterRole =
      (event.headers && (event.headers["x-inviter-role"] as string)) ||
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

    // 4. Service Logic
    const service = createUserService(docClient, tableName);
    const { user, inviteToken } = await service.createUserInvitation(validated);

    // send invite link (local stub)
    const frontend = process.env.FRONTEND_URL || "http://localhost:3000";
    const inviteLink = `${frontend}/accept-invite?token=${inviteToken}`;
    console.log("Invite link:", inviteLink);

    // 4. Standardized Response
    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        status: 201,
        message: "User invited successfully",
        data: user,
        // debug: invite link logged to console in local/dev
        inviteLink:
          process.env.SHOW_INVITE_LINK === "true" ? inviteLink : undefined,
      }),
    };
  } catch (error) {
    console.error("Error creating user:", error);
    return handleError(error); // Uses the shared error handler
  }
};
