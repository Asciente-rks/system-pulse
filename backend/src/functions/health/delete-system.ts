import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { isAdminOrSuper, isSuperAdmin } from "../../utils/rbac.js";
import {
  getActorUserId,
  rejectIfDemo,
  requireAdminActorPassword,
} from "../../utils/actor-auth.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { DEMO_ORG_ID } from "../../types/organization.js";

const effectiveOrgId = (orgId?: unknown): string =>
  typeof orgId === "string" && orgId.length > 0 ? orgId : DEMO_ORG_ID;

export const deleteSystem = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const systemsTable = process.env.SYSTEM_PULSE_TABLE;
    const usersTable = process.env.USERS_TABLE;

    if (!systemsTable || !usersTable) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          message: "SYSTEM_PULSE_TABLE or USERS_TABLE not set",
        }),
      };
    }

    await enforceRateLimit({
      docClient,
      tableName: systemsTable,
      event,
      key: "delete-system",
      limit: 10,
      windowSeconds: 60,
    });

    const body = (parse(event.body) as Record<string, unknown>) || {};
    const systemId =
      event.pathParameters?.id || (body.systemId as string | undefined);
    const actorPassword = String(body.actorPassword || "");

    if (!systemId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "system id required" }),
      };
    }

    const actorUserId = getActorUserId(event);
    const actor = await requireAdminActorPassword(
      docClient,
      usersTable,
      actorUserId,
      actorPassword,
    );

    // Demo sessions are blocked from deleting any system.
    rejectIfDemo(actor as any);

    if (!isAdminOrSuper(actor.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message: "forbidden - admin or superadmin required",
        }),
      };
    }

    const systemResponse = await docClient.send(
      new GetCommand({
        TableName: systemsTable,
        Key: { PK: "SYSTEM", SK: `SYS#${systemId}` },
      }),
    );

    if (!systemResponse.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "system not found" }),
      };
    }

    const targetSystem = systemResponse.Item as { orgId?: string };
    const targetOrgId = effectiveOrgId(targetSystem.orgId);

    // Plain admins may delete only systems within their own org.
    // Superadmins may delete any system. The demo org is read-only
    // for ALL admins (the platform owner's data).
    if (!isSuperAdmin(actor.role as any)) {
      const actorOrgId = actor.orgId || DEMO_ORG_ID;
      if (actorOrgId !== targetOrgId) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            message:
              "forbidden - cannot delete systems outside your organization",
          }),
        };
      }
      if (targetOrgId === DEMO_ORG_ID) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            message:
              "forbidden - the demo org's systems are read-only for all admins",
          }),
        };
      }
    }

    await docClient.send(
      new DeleteCommand({
        TableName: systemsTable,
        Key: { PK: "SYSTEM", SK: `SYS#${systemId}` },
      }),
    );

    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const usersResponse = await docClient.send(
        new QueryCommand({
          TableName: usersTable,
          IndexName: "EntityTypeIndex",
          KeyConditionExpression: "entityType = :entityType",
          ExpressionAttributeValues: {
            ":entityType": "USER",
          },
          ExclusiveStartKey: lastEvaluatedKey,
          Limit: 200,
        }),
      );

      const users = (usersResponse.Items || []).filter((entry) =>
        String(entry.SK || "").startsWith("USER#"),
      );

      for (const entry of users) {
        const allowedSystemIds = Array.isArray(entry.allowedSystemIds)
          ? (entry.allowedSystemIds as string[])
          : [];

        if (!allowedSystemIds.includes(systemId)) {
          continue;
        }

        const filteredIds = allowedSystemIds.filter((id) => id !== systemId);

        await docClient.send(
          new UpdateCommand({
            TableName: usersTable,
            Key: { PK: "USER", SK: entry.SK },
            UpdateExpression: "SET allowedSystemIds = :systems",
            ExpressionAttributeValues: {
              ":systems": filteredIds,
            },
          }),
        );
      }

      lastEvaluatedKey = usersResponse.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (lastEvaluatedKey);

    let logsKey: Record<string, unknown> | undefined;

    do {
      const logsResponse = await docClient.send(
        new QueryCommand({
          TableName: systemsTable,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
          ExpressionAttributeValues: {
            ":pk": `SYSTEM#${systemId}`,
            ":skPrefix": "LOG#",
          },
          ExclusiveStartKey: logsKey,
          Limit: 100,
        }),
      );

      for (const logEntry of logsResponse.Items || []) {
        await docClient.send(
          new DeleteCommand({
            TableName: systemsTable,
            Key: {
              PK: logEntry.PK,
              SK: logEntry.SK,
            },
          }),
        );
      }

      logsKey = logsResponse.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (logsKey);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "System deleted",
        data: { systemId },
      }),
    };
  } catch (error) {
    console.error("delete-system error:", error);
    return handleError(error);
  }
};
