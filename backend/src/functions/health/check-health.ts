import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { parse } from "../../utils/parse.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { createHealthSchema } from "../../validation/health-schema.js";
import { docClient } from "../../config/db.js";
import { createHealthService } from "../../services/health-service.js";
import type { CreateHealthInput } from "../../types/health.js";
import { isAdminOrSuper } from "../../utils/rbac.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";

export const createHealthCheck = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.SYSTEM_PULSE_TABLE;

    if (!tableName) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          status: 500,
          message: "SYSTEM_PULSE_TABLE environment variable is not set.",
        }),
      };
    }

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "systems-create",
      limit: 20,
      windowSeconds: 60,
    });

    const body = parse(event.body) as Record<string, unknown>;

    const inviterRole =
      (event.headers &&
        ((event.headers["x-inviter-role"] as string) ||
          (event.headers["X-Inviter-Role"] as string))) ||
      undefined;

    if (!isAdminOrSuper(inviterRole as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          status: 403,
          message: "forbidden - only admin or superadmin can add systems",
        }),
      };
    }

    const validated = (await createHealthSchema.validate(body, {
      stripUnknown: true,
    })) as CreateHealthInput;

    const service = createHealthService(docClient, tableName);
    const item = await service.createHealthCheck(validated);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        status: 201,
        message: "Health check created",
        data: item,
      }),
    };
  } catch (error) {
    console.error("Error creating health check:", error);
    return handleError(error);
  }
};
