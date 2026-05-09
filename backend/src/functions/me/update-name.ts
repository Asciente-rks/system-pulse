import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as yup from "yup";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { fullNameYup } from "../../validation/user-validation.js";
import {
  getActorUserId,
  rejectIfDemo,
  requireAdminActorPassword,
} from "../../utils/actor-auth.js";
import { loadActor } from "../../utils/actor-auth.js";
import { verifyPassword } from "../../utils/password.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { HttpError } from "../../utils/error-handler.js";

const updateNameSchema = yup.object({
  full_name: fullNameYup,
  password: yup
    .string()
    .required("Password is required")
    .max(256, "Password is too long"),
});

interface UpdateNameBody {
  full_name: string;
  password: string;
}

/**
 * `POST /me/name` — let the logged-in user change their own
 * display name. Confirms with the actor's current password to
 * stop drive-by edits via stolen sessions.
 */
export const updateMyName = async (
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
      key: "me-update-name",
      limit: 10,
      windowSeconds: 60,
    });

    const body = parse(event.body);
    const validated = (await updateNameSchema.validate(body, {
      stripUnknown: true,
    })) as UpdateNameBody;

    const actorUserId = getActorUserId(event);
    if (!actorUserId) {
      throw new HttpError(401, { message: "not authenticated" });
    }

    const actor = await loadActor(docClient, tableName, actorUserId);
    if (!actor) {
      throw new HttpError(403, { message: "actor not found" });
    }
    rejectIfDemo(actor as any);

    if (!verifyPassword(validated.password, actor.passwordHash)) {
      // Reuse the same shape as requireAdminActorPassword so the UI
      // recognises the wrong-password case identically.
      void requireAdminActorPassword;
      throw new HttpError(401, { message: "Invalid current password" });
    }

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: "USER", SK: `USER#${actorUserId}` },
        UpdateExpression: "SET full_name = :name",
        ExpressionAttributeValues: { ":name": validated.full_name },
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "Name updated",
        data: { full_name: validated.full_name },
      }),
    };
  } catch (error) {
    console.error("me-update-name error:", error);
    return handleError(error);
  }
};
