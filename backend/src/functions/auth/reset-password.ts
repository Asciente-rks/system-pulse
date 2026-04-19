import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "crypto";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { resetPasswordSchema } from "../../validation/user-validation.js";
import { hashPassword } from "../../utils/password.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";

interface ResetPasswordBody {
  token: string;
  password: string;
  confirmPassword: string;
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const resetPassword = async (
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
      key: "auth-reset-password",
      limit: 8,
      windowSeconds: 60,
    });

    const rawBody = parse(event.body);
    const tokenFromQuery = event.queryStringParameters?.token;
    const mergedBody = {
      ...(rawBody && typeof rawBody === "object" ? rawBody : {}),
      ...(tokenFromQuery ? { token: tokenFromQuery } : {}),
    };

    const validated = (await resetPasswordSchema.validate(mergedBody, {
      stripUnknown: true,
    })) as ResetPasswordBody;
    const resetTokenHash = hashResetToken(validated.token);

    const query = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "ResetTokenIndex",
        KeyConditionExpression: "resetToken = :token",
        ExpressionAttributeValues: {
          ":token": resetTokenHash,
        },
        Limit: 1,
      }),
    );

    const user = (query.Items || [])[0] as Record<string, unknown> | undefined;

    if (!user) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: "Reset token invalid or expired",
        }),
      };
    }

    const expiry = Number(user.resetTokenExpiry || 0);
    if (!expiry || expiry < Date.now()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message:
            "Password reset eligibility expired. Request a new reset link.",
        }),
      };
    }

    const passwordHash = hashPassword(validated.password);

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: user.PK, SK: user.SK },
        UpdateExpression:
          "SET passwordHash = :passwordHash REMOVE resetToken, resetTokenExpiry",
        ExpressionAttributeValues: {
          ":passwordHash": passwordHash,
        },
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "Password reset successful",
      }),
    };
  } catch (error) {
    console.error("reset-password error:", error);
    return handleError(error);
  }
};
