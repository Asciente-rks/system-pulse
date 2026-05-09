import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as yup from "yup";
import { docClient } from "../../config/db.js";
import { handleError, headers, HttpError } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { passwordYup } from "../../validation/user-validation.js";
import {
  getActorUserId,
  loadActor,
  rejectIfDemo,
} from "../../utils/actor-auth.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";

const updatePasswordSchema = yup.object({
  current_password: yup
    .string()
    .required("Current password is required")
    .max(256, "Password is too long"),
  new_password: passwordYup,
  confirm_new_password: yup
    .string()
    .oneOf([yup.ref("new_password")], "New passwords must match"),
});

interface UpdatePasswordBody {
  current_password: string;
  new_password: string;
  confirm_new_password: string;
}

/**
 * `POST /me/password` — let the logged-in user (any tier, including
 * the platform-level superadmin) rotate their own password. Confirms
 * the current password before writing the new hash. Demo accounts
 * are blocked because their record is auto-cleaned by TTL anyway.
 */
export const updateMyPassword = async (
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
      key: "me-update-password",
      limit: 8,
      windowSeconds: 60,
    });

    const body = parse(event.body);
    const validated = (await updatePasswordSchema.validate(body, {
      stripUnknown: true,
    })) as UpdatePasswordBody;

    if (validated.new_password === validated.current_password) {
      throw new HttpError(400, {
        message: "New password must differ from the current password",
      });
    }

    const actorUserId = getActorUserId(event);
    if (!actorUserId)
      throw new HttpError(401, { message: "not authenticated" });

    const actor = await loadActor(docClient, tableName, actorUserId);
    if (!actor) throw new HttpError(403, { message: "actor not found" });
    rejectIfDemo(actor as any);

    if (
      !verifyPassword(
        validated.current_password,
        (actor as any).passwordHash,
      )
    ) {
      throw new HttpError(401, { message: "Invalid current password" });
    }

    const newHash = hashPassword(validated.new_password);

    // Reset the failed-login counter at the same time so a user who
    // was about to get locked clears the deck by changing their pwd.
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: "USER", SK: `USER#${actorUserId}` },
        UpdateExpression:
          "SET passwordHash = :ph, failedLoginAttempts = :zero REMOVE lockedAt",
        ExpressionAttributeValues: {
          ":ph": newHash,
          ":zero": 0,
        },
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "Password updated",
      }),
    };
  } catch (error) {
    console.error("me-update-password error:", error);
    return handleError(error);
  }
};
