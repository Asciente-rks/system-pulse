import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleError, headers } from "../../utils/error-handler.js";
import { docClient } from "../../config/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { createHealthService } from "../../services/health-service.js";
import { isAdminOrSuper } from "../../utils/rbac.js";

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

    const systemId =
      (event.pathParameters && event.pathParameters.id) ||
      (event.body && JSON.parse(event.body).systemId);
    if (!systemId)
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "system id required" }),
      };

    const inviterRole =
      (event.headers && (event.headers["x-inviter-role"] as string)) ||
      undefined;
    const userId =
      (event.headers && (event.headers["x-user-id"] as string)) || undefined;

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

    const healthSvc = createHealthService(docClient, tableName);
    const probe = await healthSvc.runHealthCheck(systemId, system.url);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: 200, data: probe }),
    };
  } catch (error) {
    console.error("trigger-health error:", error);
    return handleError(error);
  }
};
