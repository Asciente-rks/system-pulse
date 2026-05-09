import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { registerVerifySchema } from "../../validation/user-validation.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { createOtpService, hashOtp } from "../../services/otp-service.js";
import { createOrganizationService } from "../../services/organization-service.js";
import { createUserService } from "../../services/user-service.js";
import { sendWelcomeEmail } from "../../services/email-service.js";
import { resolveFrontendBaseUrl } from "../../utils/frontend-url.js";

interface VerifyBody {
  email: string;
  otp: string;
}

const MAX_OTP_ATTEMPTS = 6;

export const registerVerify = async (
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
      key: "auth-register-verify",
      limit: 12,
      windowSeconds: 60,
    });

    const body = parse(event.body);
    const validated = (await registerVerifySchema.validate(body, {
      stripUnknown: true,
    })) as VerifyBody;

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

    if (pending.expiresAt && pending.expiresAt < nowSeconds) {
      await otpService.deletePending(validated.email);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          status: 400,
          message:
            "Verification code expired. Please start registration again.",
        }),
      };
    }

    if ((pending.attempts || 0) >= MAX_OTP_ATTEMPTS) {
      await otpService.deletePending(validated.email);
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          status: 429,
          message:
            "Too many incorrect attempts. Please start registration again.",
        }),
      };
    }

    const expectedHash = hashOtp(validated.otp);
    if (expectedHash !== pending.otpHash) {
      // Increment attempts to throttle brute-force.
      await otpService.putPending({
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

    // OTP good. Mint the user id up-front so we can stamp it as the
    // org owner, then create the org, then create the user — single
    // Put per record.
    const userId = uuidv4();
    const orgService = createOrganizationService(docClient, tableName);
    const userService = createUserService(docClient, tableName);

    const org = await orgService.createOrganization({
      name: pending.org_name,
      ownerId: userId,
    });

    const user = await userService.createActiveAdmin({
      email: pending.email,
      full_name: pending.full_name,
      passwordHash: pending.passwordHash,
      orgId: org.id,
      explicitId: userId,
    });

    await otpService.deletePending(validated.email);

    const frontend = resolveFrontendBaseUrl(event.headers);
    try {
      await sendWelcomeEmail({
        to: user.email,
        fullName: user.full_name,
        orgName: org.name,
        loginLink: `${frontend}/login`,
      });
    } catch (emailError) {
      console.error("Welcome email send failed:", emailError);
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        status: 201,
        message:
          "Account verified. Your free organization is ready with unlimited systems to track.",
        data: {
          user: {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            role: user.role,
            status_: user.status_,
            allowedSystemIds: user.allowedSystemIds || [],
            orgId: org.id,
            orgName: org.name,
          },
          org: {
            id: org.id,
            name: org.name,
            createDate: org.createDate,
          },
        },
      }),
    };
  } catch (error) {
    console.error("register-verify error:", error);
    return handleError(error);
  }
};
