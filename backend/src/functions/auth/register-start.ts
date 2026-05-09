import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { registerStartSchema } from "../../validation/user-validation.js";
import { hashPassword } from "../../utils/password.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import {
  createOtpService,
  generateNumericOtp,
  hashOtp,
  type PendingRegistration,
} from "../../services/otp-service.js";
import { sendOtpEmail } from "../../services/email-service.js";

interface RegisterStartBody {
  email: string;
  password: string;
  confirmPassword: string;
  full_name: string;
  org_name: string;
}

const OTP_DEFAULT_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 30;
const MAX_RESENDS_PER_REGISTRATION = 5;

export const registerStart = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.USERS_TABLE;

    if (!tableName) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: "USERS_TABLE not set" }),
      };
    }

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "auth-register-start",
      limit: 8,
      windowSeconds: 60,
    });

    const body = parse(event.body);
    const validated = (await registerStartSchema.validate(body, {
      stripUnknown: true,
    })) as RegisterStartBody;

    // Reject if an active user with this email already exists. We
    // intentionally do NOT leak that info via 409 to opportunists,
    // but we do block in-flight collisions.
    const existing = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "EntityTypeIndex",
        KeyConditionExpression: "entityType = :entityType",
        FilterExpression: "email = :email",
        ExpressionAttributeValues: {
          ":entityType": "USER",
          ":email": validated.email,
        },
        Limit: 5,
      }),
    );

    const matchingUsers = (existing.Items || []).filter((item) =>
      String(item.SK || "").startsWith("USER#"),
    );

    const otpTtlMinutes = Math.max(
      2,
      Number(process.env.REGISTER_OTP_TTL_MINUTES || OTP_DEFAULT_TTL_MINUTES),
    );

    if (matchingUsers.length > 0) {
      // Generic response — same shape and content as the success
      // path so the caller can't distinguish "email already taken"
      // from "code sent" via response inspection.
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: 200,
          message:
            "If this email is available, a verification code has been sent.",
          data: {
            email: validated.email,
            expiresInMinutes: otpTtlMinutes,
          },
        }),
      };
    }

    const otpService = createOtpService(docClient, tableName);
    const existingPending = await otpService.getPending(validated.email);

    const nowSeconds = Math.floor(Date.now() / 1000);

    if (existingPending && existingPending.lastSentAt) {
      const sinceLastSend = nowSeconds - existingPending.lastSentAt;
      if (sinceLastSend < RESEND_COOLDOWN_SECONDS) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({
            status: 429,
            message: `Please wait ${RESEND_COOLDOWN_SECONDS - sinceLastSend}s before requesting another code.`,
          }),
        };
      }
    }

    const otp = generateNumericOtp(6);
    const otpHash = hashOtp(otp);
    const expiresAt = nowSeconds + otpTtlMinutes * 60;

    const pending: PendingRegistration = {
      email: validated.email,
      passwordHash: hashPassword(validated.password),
      full_name: validated.full_name,
      org_name: validated.org_name,
      otpHash,
      expiresAt,
      attempts: 0,
      resendCount: existingPending?.resendCount || 0,
      lastSentAt: nowSeconds,
      createDate: new Date().toISOString(),
    };

    if (
      existingPending &&
      pending.resendCount >= MAX_RESENDS_PER_REGISTRATION
    ) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          status: 429,
          message:
            "Too many verification attempts for this email. Please try again later.",
        }),
      };
    }

    await otpService.putPending(pending);

    let emailSent = false;
    try {
      await sendOtpEmail({
        to: validated.email,
        otp,
        fullName: validated.full_name,
        expiresInMinutes: otpTtlMinutes,
      });
      emailSent = true;
    } catch (emailError) {
      console.error("OTP email send failed:", emailError);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: emailSent
          ? "Verification code sent to your email."
          : "Verification code generated, but email delivery failed. Contact support.",
        data: {
          email: validated.email,
          expiresInMinutes: otpTtlMinutes,
          // Echo OTP only when explicitly enabled (dev/local). NEVER
          // turn this on in production.
          devOtp:
            process.env.SHOW_REGISTER_OTP === "true" ? otp : undefined,
        },
      }),
    };
  } catch (error) {
    console.error("register-start error:", error);
    return handleError(error);
  }
};
