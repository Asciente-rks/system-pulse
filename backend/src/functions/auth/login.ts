import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { loginSchema } from "../../validation/user-validation.js";
import { verifyPassword } from "../../utils/password.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import {
  MAX_FAILED_LOGIN_ATTEMPTS,
  resolvePermissions,
} from "../../types/user.js";

interface LoginBody {
  email: string;
  password: string;
}

const LOCKED_MESSAGE =
  "Account locked due to too many failed login attempts. Contact your supervisor or org admin to unlock.";

export const login = async (
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
      key: "auth-login",
      limit: 10,
      windowSeconds: 60,
    });

    const body = parse(event.body);
    const validated = (await loginSchema.validate(body, {
      stripUnknown: true,
    })) as LoginBody;

    const response = await docClient.send(
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

    const users = (response.Items || []) as Array<Record<string, unknown>>;
    const user = users.find((item) => item.SK?.toString().startsWith("USER#"));

    if (!user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ message: "Invalid email or password" }),
      };
    }

    // Locked accounts cannot proceed regardless of password match.
    // We answer with 423 (RFC 4918) so the client can recognise the
    // distinct case and show the contact-supervisor UI.
    if (typeof user.lockedAt === "string" && user.lockedAt.length > 0) {
      return {
        statusCode: 423,
        headers,
        body: JSON.stringify({
          status: 423,
          message: LOCKED_MESSAGE,
        }),
      };
    }

    if (
      !verifyPassword(
        validated.password,
        user.passwordHash as string | undefined,
      )
    ) {
      // Increment the failed counter and lock if we crossed the cap.
      const currentAttempts = Number(user.failedLoginAttempts || 0) + 1;
      const willLock = currentAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;

      try {
        await docClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: user.PK, SK: user.SK },
            UpdateExpression: willLock
              ? "SET failedLoginAttempts = :n, lockedAt = :ts"
              : "SET failedLoginAttempts = :n",
            ExpressionAttributeValues: willLock
              ? {
                  ":n": currentAttempts,
                  ":ts": new Date().toISOString(),
                }
              : { ":n": currentAttempts },
          }),
        );
      } catch (counterError) {
        console.warn("login: failed-counter update failed", counterError);
      }

      if (willLock) {
        return {
          statusCode: 423,
          headers,
          body: JSON.stringify({
            status: 423,
            message: LOCKED_MESSAGE,
          }),
        };
      }

      const remaining = MAX_FAILED_LOGIN_ATTEMPTS - currentAttempts;
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          message: `Invalid email or password. ${remaining} attempt${
            remaining === 1 ? "" : "s"
          } left before the account is locked.`,
        }),
      };
    }

    if (user.status_ !== "Active") {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message: `Account is ${String(user.status_ || "Inactive")}. Contact your administrator.`,
        }),
      };
    }

    // Successful login: reset the failed counter so an unlucky typo
    // streak doesn't lock the user later.
    if (Number(user.failedLoginAttempts || 0) > 0) {
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: user.PK, SK: user.SK },
            UpdateExpression:
              "SET failedLoginAttempts = :zero REMOVE lockedAt",
            ExpressionAttributeValues: { ":zero": 0 },
          }),
        );
      } catch (resetError) {
        console.warn("login: failed-counter reset failed", resetError);
      }
    }

    // Resolve org name (best-effort).
    let orgName: string | undefined;
    const orgId = (user.orgId as string | undefined) || undefined;
    if (orgId) {
      try {
        const orgResponse = await docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { PK: "ORG", SK: `ORG#${orgId}` },
          }),
        );
        orgName = (orgResponse.Item as { name?: string } | undefined)?.name;
      } catch (orgError) {
        console.warn("Org lookup failed during login:", orgError);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "Login successful",
        data: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          status_: user.status_,
          allowedSystemIds: Array.isArray(user.allowedSystemIds)
            ? user.allowedSystemIds
            : [],
          orgId,
          orgName,
          demoMode: Boolean(user.demoMode),
          permissions: resolvePermissions(user as any),
        },
      }),
    };
  } catch (error) {
    console.error("login error:", error);
    return handleError(error);
  }
};
