import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { canInviteRole, isAdminOrSuper } from "../../utils/rbac.js";

export const getUser = async (
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

    const inviterRole =
      (event.headers &&
        ((event.headers["x-inviter-role"] as string) ||
          (event.headers["X-Inviter-Role"] as string))) ||
      undefined;

    if (!isAdminOrSuper(inviterRole as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: "forbidden" }),
      };
    }

    const userId = event.pathParameters?.id;
    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "user id required" }),
      };
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: "USER", SK: `USER#${userId}` },
      }),
    );

    const user = result.Item;

    if (!user) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "user not found" }),
      };
    }

    if (!canInviteRole(inviterRole as any, user.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: "forbidden - out of role scope" }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        data: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          status_: user.status_,
          createDate: user.createDate,
          allowedSystemIds: Array.isArray(user.allowedSystemIds)
            ? user.allowedSystemIds
            : [],
        },
      }),
    };
  } catch (error) {
    console.error("get-user error:", error);
    return handleError(error);
  }
};
