import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { parse } from "../../utils/parse.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { setupPasswordSchema } from "../../validation/user-validation.js";
import { docClient } from "../../config/db.js";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { hashPassword } from "../../utils/password.js";

export const acceptUserInvitation = async (
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

    const body = parse(event.body) as Record<string, unknown>;
    const token =
      (body && (body.token as string)) || event.queryStringParameters?.token;
    if (!token) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "invite token is required" }),
      };
    }

    const validated = (await setupPasswordSchema.validate(body, {
      stripUnknown: true,
    })) as Record<string, string>;
    const password = validated.password;

    const q = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "InviteTokenIndex",
        KeyConditionExpression: "inviteToken = :t",
        ExpressionAttributeValues: {
          ":t": token,
        },
        Limit: 1,
      }),
    );

    const items = (q as any).Items || [];
    if (items.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "Invite token not found" }),
      };
    }

    const user = items[0] as any;
    const expiry = user.tokenExpiry;
    if (expiry && expiry < Date.now()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: "Invite eligibility expired. Request a new invite.",
        }),
      };
    }

    const passwordHash = hashPassword(password);

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: user.PK, SK: user.SK },
        UpdateExpression:
          "SET passwordHash = :ph, #s = :active REMOVE inviteToken, tokenExpiry",
        ExpressionAttributeNames: { "#s": "status_" },
        ExpressionAttributeValues: { ":ph": passwordHash, ":active": "Active" },
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "Password set; account activated",
      }),
    };
  } catch (error) {
    console.error("accept-invite error:", error);
    return handleError(error);
  }
};
