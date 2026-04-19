import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { parse } from "../../utils/parse.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { docClient } from "../../config/db.js";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { canInviteRole, isAdminOrSuper } from "../../utils/rbac.js";
import { USER_STATUSES } from "../../types/user.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";

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

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "users-assign-systems",
      limit: 30,
      windowSeconds: 60,
    });

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

    const body = parse(event.body) as Record<string, unknown>;
    const userId =
      (event.pathParameters && event.pathParameters.id) ||
      (body && (body.userId as string));
    const systemIds = (body && (body.systemIds as string[])) || [];
    const requestedStatus =
      (body && (body.status_ as string | undefined)) || undefined;

    if (!userId || !Array.isArray(systemIds)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "userId and systemIds[] required" }),
      };
    }

    if (
      requestedStatus &&
      !USER_STATUSES.includes(requestedStatus as (typeof USER_STATUSES)[number])
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: `status_ must be one of: ${USER_STATUSES.join(", ")}`,
        }),
      };
    }

    const targetUserResponse = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: "USER", SK: `USER#${userId}` },
      }),
    );

    const targetUser = targetUserResponse.Item as { role?: string } | undefined;

    if (!targetUser) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "user not found" }),
      };
    }

    if (!canInviteRole(inviterRole as any, targetUser.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: "forbidden - out of role scope" }),
      };
    }

    const updateExpressionParts = ["allowedSystemIds = :systems"];
    const expressionAttributeValues: Record<string, unknown> = {
      ":systems": systemIds,
    };
    const expressionAttributeNames: Record<string, string> = {};

    if (requestedStatus) {
      updateExpressionParts.push("#status = :status");
      expressionAttributeNames["#status"] = "status_";
      expressionAttributeValues[":status"] = requestedStatus;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: "USER", SK: `USER#${userId}` },
        UpdateExpression: `SET ${updateExpressionParts.join(", ")}`,
        ExpressionAttributeValues: expressionAttributeValues,
        ...(Object.keys(expressionAttributeNames).length > 0
          ? { ExpressionAttributeNames: expressionAttributeNames }
          : {}),
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "User access updated",
        data: {
          userId,
          systemIds,
          status_: requestedStatus,
        },
      }),
    };
  } catch (error) {
    console.error("assign-system-access error:", error);
    return handleError(error);
  }
};
