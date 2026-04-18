import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { parse } from "../../utils/parse.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { docClient } from "../../config/db.js";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { isAdminOrSuper } from "../../utils/rbac.js";

export const assignSystemAccess = async (
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

    const inviterRole =
      (event.headers && (event.headers["x-inviter-role"] as string)) ||
      undefined;
    if (!isAdminOrSuper(inviterRole as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: "forbidden" }),
      };
    }

    const body = parse(event.body) as Record<string, unknown>;
    const userId =
      (event.pathParameters && event.pathParameters.id) ||
      (body && (body.userId as string));
    const systemIds = (body && (body.systemIds as string[])) || [];

    if (!userId || !Array.isArray(systemIds)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "userId and systemIds[] required" }),
      };
    }

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: "USER", SK: `USER#${userId}` },
        UpdateExpression: "SET allowedSystemIds = :s",
        ExpressionAttributeValues: { ":s": systemIds },
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: 200, message: "assigned" }),
    };
  } catch (error) {
    console.error("assign-system-access error:", error);
    return handleError(error);
  }
};
