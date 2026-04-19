import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { createHealthService } from "../../services/health-service.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { isAdminOrSuper } from "../../utils/rbac.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";

export const getSystemLogs = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.SYSTEM_PULSE_TABLE;
    if (!tableName) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: "SYSTEM_PULSE_TABLE not set" }),
      };
    }

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "systems-logs",
      limit: 60,
      windowSeconds: 60,
    });

    const systemId = event.pathParameters?.id;
    if (!systemId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "system id required" }),
      };
    }

    const inviterRole =
      (event.headers &&
        ((event.headers["x-inviter-role"] as string) ||
          (event.headers["X-Inviter-Role"] as string))) ||
      undefined;

    const userId =
      (event.headers &&
        ((event.headers["x-user-id"] as string) ||
          (event.headers["X-User-Id"] as string))) ||
      undefined;

    if (!isAdminOrSuper(inviterRole as any)) {
      if (!userId) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - user id required" }),
        };
      }

      const userRes: any = await docClient.send(
        new GetCommand({
          TableName: process.env.USERS_TABLE!,
          Key: { PK: "USER", SK: `USER#${userId}` },
        }),
      );

      const user = userRes.Item || {};
      const allowed: string[] = user.allowedSystemIds || [];

      if (user.status_ !== "Active" || !allowed.includes(systemId)) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - no access to logs" }),
        };
      }
    }

    const limit = Number(event.queryStringParameters?.limit || 20);
    const service = createHealthService(docClient, tableName);
    const logs = await service.listHealthLogs(systemId, limit);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        data: {
          systemId,
          logs,
        },
      }),
    };
  } catch (error) {
    console.error("get-system-logs error:", error);
    return handleError(error);
  }
};
