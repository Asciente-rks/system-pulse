import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import * as yup from "yup";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { emailYup } from "../../validation/user-validation.js";
import {
  getActorUserId,
  loadActor,
  rejectIfDemo,
} from "../../utils/actor-auth.js";
import { verifyPassword } from "../../utils/password.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { HttpError } from "../../utils/error-handler.js";
import {
  createEmailChangeOtpService,
} from "../../services/email-change-otp-service.js";
import {
  generateNumericOtp,
  hashOtp,
} from "../../services/otp-service.js";
import { sendOtpEmail } from "../../services/email-service.js";

const updateEmailStartSchema = yup.object({
  new_email: emailYup,
  password: yup
    .string()
    .required("Password is required")
    .max(256, "Password is too long"),
});

interface Body {
  new_email: string;
  password: string;
}

const OTP_TTL_MINUTES = 10;

export const updateMyEmailStart = async (
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
      key: "me-update-email-start",
      limit: 6,
      windowSeconds: 60,
    });

    const body = parse(event.body);
    const validated = (await updateEmailStartSchema.validate(body, {
      stripUnknown: true,
    })) as Body;

    const actorUserId = getActorUserId(event);
    if (!actorUserId) throw new HttpError(401, { message: "not authenticated" });

    const actor = await loadActor(docClient, tableName, actorUserId);
    if (!actor) throw new HttpError(403, { message: "actor not found" });
    rejectIfDemo(actor as any);

    if (!verifyPassword(validated.password, (actor as any).passwordHash)) {
      throw new HttpError(401, { message: "Invalid current password" });
    }

    // Refuse if the new email already belongs to another USER.
    const existing = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "EntityTypeIndex",
        KeyConditionExpression: "entityType = :entityType",
        FilterExpression: "email = :email",
        ExpressionAttributeValues: {
          ":entityType": "USER",
          ":email": validated.new_email,
        },
        Limit: 5,
      }),
    );

    const collisions = (existing.Items || []).filter((item) =>
      String(item.SK || "").startsWith("USER#"),
    );
    if (collisions.length > 0 && collisions[0].id !== actor.id) {
      // Don't leak which email is taken — return success and just
      // never deliver a code. Same shape as the register endpoint.
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: 200,
          message:
            "If that email is available, a verification code has been sent.",
          data: { expiresInMinutes: OTP_TTL_MINUTES },
        }),
      };
    }

    const otp = generateNumericOtp(6);
    const otpService = createEmailChangeOtpService(docClient, tableName);
    const nowSeconds = Math.floor(Date.now() / 1000);

    await otpService.put({
      userId: actor.id,
      newEmail: validated.new_email,
      otpHash: hashOtp(otp),
      expiresAt: nowSeconds + OTP_TTL_MINUTES * 60,
      attempts: 0,
      createDate: new Date().toISOString(),
    });

    let emailSent = false;
    try {
      await sendOtpEmail({
        to: validated.new_email,
        otp,
        fullName: (actor as any).full_name || "there",
        expiresInMinutes: OTP_TTL_MINUTES,
      });
      emailSent = true;
    } catch (mailErr) {
      console.error("update-email OTP send failed:", mailErr);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: emailSent
          ? "Verification code sent to the new email."
          : "Verification code generated, but email delivery failed.",
        data: {
          expiresInMinutes: OTP_TTL_MINUTES,
          devOtp:
            process.env.SHOW_REGISTER_OTP === "true" ? otp : undefined,
        },
      }),
    };
  } catch (error) {
    console.error("me-update-email-start error:", error);
    return handleError(error);
  }
};
