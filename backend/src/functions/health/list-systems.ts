import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { isAdminOrSuper } from "../../utils/rbac.js";
import { resolveDeploymentMode } from "../../utils/health-workflow.js";

type HealthSystemRecord = {
  id: string;
  name: string;
  url: string;
  deploymentMode: "render" | "standard";
  status?: "UP" | "DOWN" | "UNKNOWN";
  createDate: string;
  lastChecked?: string;
  lastResponseCode?: number;
  responseTimeMs?: number;
};

export const listSystems = async (
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

    const limit = Number(event.queryStringParameters?.limit || 100);

    const systemsResponse = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": "SYSTEM",
          ":skPrefix": "SYS#",
        },
        ScanIndexForward: false,
        Limit: Math.max(1, Math.min(limit, 200)),
      }),
    );

    let systems = (systemsResponse.Items || []).map((item) => ({
      id: item.id,
      name: item.name,
      url: item.url,
      deploymentMode: resolveDeploymentMode(item.url, item.deploymentMode),
      status: item.status,
      createDate: item.createDate,
      lastChecked: item.lastChecked,
      lastResponseCode: item.lastResponseCode,
      responseTimeMs: item.responseTimeMs,
    })) as HealthSystemRecord[];

    if (!isAdminOrSuper(inviterRole as any)) {
      if (!userId) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - user id required" }),
        };
      }

      const userResponse: any = await docClient.send(
        new GetCommand({
          TableName: process.env.USERS_TABLE!,
          Key: { PK: "USER", SK: `USER#${userId}` },
        }),
      );

      const user = userResponse.Item || {};
      const allowedSystemIds = Array.isArray(user.allowedSystemIds)
        ? (user.allowedSystemIds as string[])
        : [];

      if (user.status_ !== "Active") {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - user is not active" }),
        };
      }

      systems = systems.filter((system) =>
        allowedSystemIds.includes(system.id),
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        data: {
          systems,
          count: systems.length,
        },
      }),
    };
  } catch (error) {
    console.error("list-systems error:", error);
    return handleError(error);
  }
};
