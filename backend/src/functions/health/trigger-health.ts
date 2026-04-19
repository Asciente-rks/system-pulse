import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { enqueueHealthCheck } from "../../services/queue-service.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { isAdminOrSuper } from "../../utils/rbac.js";
import type { HealthCheckQueueMessage } from "../../types/health-events.js";
import { parse } from "../../utils/parse.js";

export const triggerHealthCheck = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.SYSTEM_PULSE_TABLE;
    if (!tableName)
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: "SYSTEM_PULSE_TABLE not set" }),
      };

    const queueUrl = process.env.HEALTH_CHECK_QUEUE_URL;
    if (!queueUrl) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: "HEALTH_CHECK_QUEUE_URL not set" }),
      };
    }

    const body = parse(event.body);

    const systemId =
      (event.pathParameters && event.pathParameters.id) ||
      (body && (body.systemId as string));

    if (!systemId)
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "system id required" }),
      };

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
      if (!userId)
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - user id required" }),
        };
      const userRes: any = await docClient.send(
        new GetCommand({
          TableName: process.env.USERS_TABLE!,
          Key: { PK: "USER", SK: `USER#${userId}` },
        }),
      );

      const user = userRes.Item || {};
      const allowed: string[] = user.allowedSystemIds || [];
      if (user.status_ !== "Active") {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - user is not active" }),
        };
      }

      if (!allowed.includes(systemId))
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - no access to system" }),
        };
    }

    const sRes: any = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: "SYSTEM", SK: `SYS#${systemId}` },
      }),
    );
    const system = sRes.Item;
    if (!system)
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "system not found" }),
      };

    const queuedMessage: HealthCheckQueueMessage = {
      systemId,
      attempt: 1,
      requestedBy: userId,
      requestedAt: new Date().toISOString(),
    };

    await enqueueHealthCheck(queuedMessage, 0);

    return {
      statusCode: 202,
      headers,
      body: JSON.stringify({
        status: 202,
        message: "Health check queued. Automatic wake-up recheck is enabled.",
        data: {
          systemId,
          attempt: 1,
          delayedRecheckSeconds: Number(
            process.env.RENDER_WAKEUP_DELAY_SECONDS || 90,
          ),
        },
      }),
    };
  } catch (error) {
    console.error("trigger-health error:", error);
    return handleError(error);
  }
};
