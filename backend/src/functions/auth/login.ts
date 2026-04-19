import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { loginSchema } from "../../validation/user-validation.js";
import { verifyPassword } from "../../utils/password.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";

interface LoginBody {
  email: string;
  password: string;
}

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

    if (
      !verifyPassword(
        validated.password,
        user.passwordHash as string | undefined,
      )
    ) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ message: "Invalid email or password" }),
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
        },
      }),
    };
  } catch (error) {
    console.error("login error:", error);
    return handleError(error);
  }
};
