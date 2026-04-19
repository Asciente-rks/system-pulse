import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { forgotPasswordSchema } from "../../validation/user-validation.js";
import { sendPasswordResetEmail } from "../../services/email-service.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { resolveFrontendBaseUrl } from "../../utils/frontend-url.js";

interface ForgotPasswordBody {
  email: string;
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const forgotPassword = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.USERS_TABLE;

    if (!tableName) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          message: "USERS_TABLE environment variable is not set.",
        }),
      };
    }

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "auth-forgot-password",
      limit: 6,
      windowSeconds: 60,
    });

    const body = parse(event.body);
    const validated = (await forgotPasswordSchema.validate(body, {
      stripUnknown: true,
    })) as ForgotPasswordBody;

    const lookup = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "EntityTypeIndex",
        KeyConditionExpression: "entityType = :entityType",
        FilterExpression: "email = :email",
        ExpressionAttributeValues: {
          ":entityType": "USER",
          ":email": validated.email,
        },
        Limit: 50,
      }),
    );

    const user = (lookup.Items || []).find((item) =>
      String(item.SK || "").startsWith("USER#"),
    ) as Record<string, unknown> | undefined;

    if (user && user.status_ === "Active") {
      const minutes = Math.max(
        5,
        Number(process.env.PASSWORD_RESET_ELIGIBILITY_MINUTES || 30),
      );
      const expiryMs = Date.now() + minutes * 60 * 1000;
      const resetToken = uuidv4();
      const resetTokenHash = hashResetToken(resetToken);
      const eligibilityExpiresAt = new Date(expiryMs).toISOString();

      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: user.PK, SK: user.SK },
          UpdateExpression:
            "SET resetToken = :token, resetTokenExpiry = :expiry",
          ExpressionAttributeValues: {
            ":token": resetTokenHash,
            ":expiry": expiryMs,
          },
        }),
      );

      const frontend = resolveFrontendBaseUrl(event.headers);
      const resetLink = `${frontend}/reset-password?token=${resetToken}`;

      try {
        await sendPasswordResetEmail({
          to: String(user.email || validated.email),
          resetLink,
          eligibilityExpiresAt,
        });
      } catch (emailError) {
        console.error("Password reset email send failed:", emailError);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message:
          "If the account exists and is eligible, a password reset email has been sent.",
      }),
    };
  } catch (error) {
    console.error("forgot-password error:", error);
    return handleError(error);
  }
};
