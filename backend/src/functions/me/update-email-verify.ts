import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as yup from "yup";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { otpYup } from "../../validation/user-validation.js";
import {
  getActorUserId,
  loadActor,
  rejectIfDemo,
} from "../../utils/actor-auth.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { HttpError } from "../../utils/error-handler.js";
import {
  createEmailChangeOtpService,
} from "../../services/email-change-otp-service.js";

const verifySchema = yup.object({
  otp: otpYup,
});

interface Body {
  otp: string;
}

const MAX_OTP_ATTEMPTS = 6;

export const updateMyEmailVerify = async (
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
      key: "me-update-email-verify",
      limit: 12,
      windowSeconds: 60,
    });

    const body = parse(event.body);
    const validated = (await verifySchema.validate(body, {
      stripUnknown: true,
    })) as Body;

    const actorUserId = getActorUserId(event);
    if (!actorUserId)
      throw new HttpError(401, { message: "not authenticated" });

    const actor = await loadActor(docClient, tableName, actorUserId);
    if (!actor) throw new HttpError(403, { message: "actor not found" });
    rejectIfDemo(actor as any);

    const otpService = createEmailChangeOtpService(docClient, tableName);
    const pending = await otpService.get(actor.id);
    if (!pending) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          status: 400,
          message: "No pending email change. Start the flow again.",
        }),
      };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (pending.expiresAt && pending.expiresAt < nowSeconds) {
      await otpService.delete(actor.id);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          status: 400,
          message: "Code expired. Request a new one.",
        }),
      };
    }

    if ((pending.attempts || 0) >= MAX_OTP_ATTEMPTS) {
      await otpService.delete(actor.id);
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          status: 429,
          message: "Too many attempts. Request a new code.",
        }),
      };
    }

    if (otpService.hashOtp(validated.otp) !== pending.otpHash) {
      await otpService.put({
        ...pending,
        attempts: (pending.attempts || 0) + 1,
      });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          status: 400,
          message: "Invalid verification code.",
        }),
      };
    }

    // Persist the new email.
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: "USER", SK: `USER#${actor.id}` },
        UpdateExpression: "SET email = :email",
        ExpressionAttributeValues: { ":email": pending.newEmail },
      }),
    );

    await otpService.delete(actor.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "Email updated",
        data: { email: pending.newEmail },
      }),
    };
  } catch (error) {
    console.error("me-update-email-verify error:", error);
    return handleError(error);
  }
};
