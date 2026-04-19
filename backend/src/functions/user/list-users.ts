import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { canInviteRole, isAdminOrSuper } from "../../utils/rbac.js";

export const listUsers = async (
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

    const limit = Number(event.queryStringParameters?.limit || 100);

    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "EntityTypeIndex",
        KeyConditionExpression: "entityType = :entityType",
        ExpressionAttributeValues: {
          ":entityType": "USER",
        },
        ScanIndexForward: false,
        Limit: Math.max(1, Math.min(limit, 200)),
      }),
    );

    const users = (result.Items || [])
      .filter((item) => String(item.SK || "").startsWith("USER#"))
      .filter((item) => canInviteRole(inviterRole as any, item.role as any))
      .map((item) => ({
        id: item.id,
        email: item.email,
        full_name: item.full_name,
        role: item.role,
        status_: item.status_,
        createDate: item.createDate,
        allowedSystemIds: Array.isArray(item.allowedSystemIds)
          ? item.allowedSystemIds
          : [],
      }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        data: {
          users,
          count: users.length,
        },
      }),
    };
  } catch (error) {
    console.error("list-users error:", error);
    return handleError(error);
  }
};
