import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { canInviteRole } from "../../utils/rbac.js";
import {
  getActorUserId,
  requireAdminActorPassword,
} from "../../utils/actor-auth.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";

export const deleteUser = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const usersTable = process.env.USERS_TABLE;

    if (!usersTable) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: "USERS_TABLE not set" }),
      };
    }

    await enforceRateLimit({
      docClient,
      tableName: usersTable,
      event,
      key: "delete-user",
      limit: 10,
      windowSeconds: 60,
    });

    const body = (parse(event.body) as Record<string, unknown>) || {};
    const targetUserId =
      event.pathParameters?.id || (body.userId as string | undefined);
    const actorPassword = String(body.actorPassword || "");

    if (!targetUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "user id required" }),
      };
    }

    const actorUserId = getActorUserId(event);
    const actor = await requireAdminActorPassword(
      docClient,
      usersTable,
      actorUserId,
      actorPassword,
    );

    if (actor.id === targetUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "cannot delete your own account" }),
      };
    }

    const targetResponse = await docClient.send(
      new GetCommand({
        TableName: usersTable,
        Key: { PK: "USER", SK: `USER#${targetUserId}` },
      }),
    );

    const target = targetResponse.Item as { role?: string } | undefined;

    if (!target) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "user not found" }),
      };
    }

    if (!canInviteRole(actor.role as any, target.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: "forbidden - out of role scope" }),
      };
    }

    await docClient.send(
      new DeleteCommand({
        TableName: usersTable,
        Key: { PK: "USER", SK: `USER#${targetUserId}` },
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "User deleted",
        data: { userId: targetUserId },
      }),
    };
  } catch (error) {
    console.error("delete-user error:", error);
    return handleError(error);
  }
};
