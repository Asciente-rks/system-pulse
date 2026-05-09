import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { registerResendSchema } from "../../validation/user-validation.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import {
  createOtpService,
  generateNumericOtp,
  hashOtp,
} from "../../services/otp-service.js";
import { sendOtpEmail } from "../../services/email-service.js";

const RESEND_COOLDOWN_SECONDS = 30;
const MAX_RESENDS_PER_REGISTRATION = 5;
const OTP_DEFAULT_TTL_MINUTES = 10;

export const registerResend = async (
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
      key: "auth-register-resend",
      limit: 4,
      windowSeconds: 60,
    });

    const body = parse(event.body);
    const validated = (await registerResendSchema.validate(body, {
      stripUnknown: true,
    })) as { email: string };

    const otpService = createOtpService(docClient, tableName);
    const pending = await otpService.getPending(validated.email);

    if (!pending) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          status: 400,
          message:
            "No pending registration found. Please start registration again.",
        }),
      };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    if (pending.lastSentAt && nowSeconds - pending.lastSentAt < RESEND_COOLDOWN_SECONDS) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          status: 429,
          message: `Please wait ${
            RESEND_COOLDOWN_SECONDS - (nowSeconds - pending.lastSentAt)
          }s before requesting another code.`,
        }),
      };
    }

    if ((pending.resendCount || 0) >= MAX_RESENDS_PER_REGISTRATION) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          status: 429,
          message: "Resend limit reached. Please start registration again.",
        }),
      };
    }

    const otpTtlMinutes = Math.max(
      2,
      Number(process.env.REGISTER_OTP_TTL_MINUTES || OTP_DEFAULT_TTL_MINUTES),
    );

    const otp = generateNumericOtp(6);
    const newHash = hashOtp(otp);
    const newExpiresAt = nowSeconds + otpTtlMinutes * 60;

    await otpService.putPending({
      ...pending,
      otpHash: newHash,
      expiresAt: newExpiresAt,
      attempts: 0,
      resendCount: (pending.resendCount || 0) + 1,
      lastSentAt: nowSeconds,
    });

    let emailSent = false;
    try {
      await sendOtpEmail({
        to: pending.email,
        otp,
        fullName: pending.full_name,
        expiresInMinutes: otpTtlMinutes,
      });
      emailSent = true;
    } catch (emailError) {
      console.error("OTP resend email send failed:", emailError);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: emailSent
          ? "A new verification code has been sent."
          : "Code generated, but email delivery failed.",
        data: {
          email: pending.email,
          expiresInMinutes: otpTtlMinutes,
          devOtp:
            process.env.SHOW_REGISTER_OTP === "true" ? otp : undefined,
        },
      }),
    };
  } catch (error) {
    console.error("register-resend error:", error);
    return handleError(error);
  }
};
