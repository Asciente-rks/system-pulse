import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { enqueueHealthCheck } from "../../services/queue-service.js";
import { invokeHealthWorker } from "../../services/worker-invoke-service.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { isAdminOrSuper, isSuperAdmin } from "../../utils/rbac.js";
import type { HealthCheckQueueMessage } from "../../types/health-events.js";
import { parse } from "../../utils/parse.js";
import {
  resolveDeploymentMode,
  shouldUseRenderWakeupWorkflow,
} from "../../utils/health-workflow.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { DEMO_ORG_ID } from "../../types/organization.js";

const effectiveOrgId = (orgId?: unknown): string =>
  typeof orgId === "string" && orgId.length > 0 ? orgId : DEMO_ORG_ID;

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

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "systems-trigger-health",
      limit: 60,
      windowSeconds: 60,
    });

    const dispatchMode = (
      process.env.HEALTH_TRIGGER_TRANSPORT || "lambda-direct"
    ).toLowerCase();

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

    // Resolve actor (DB-of-record)
    let actorOrgId: string | undefined;
    let actorRole = inviterRole;
    let actorAllowed: string[] = [];
    let actorIsActive = true;
    if (userId) {
      try {
        const userRes: any = await docClient.send(
          new GetCommand({
            TableName: process.env.USERS_TABLE!,
            Key: { PK: "USER", SK: `USER#${userId}` },
          }),
        );
        const u = userRes.Item || {};
        actorOrgId = u.orgId as string | undefined;
        actorRole = (u.role as string | undefined) || actorRole;
        actorAllowed = Array.isArray(u.allowedSystemIds)
          ? u.allowedSystemIds
          : [];
        actorIsActive = u.status_ === "Active";
      } catch {}
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

    const systemOrgId = effectiveOrgId(system.orgId);

    if (!isSuperAdmin(actorRole as any)) {
      const scopedOrgId = actorOrgId || DEMO_ORG_ID;
      if (systemOrgId !== scopedOrgId) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - out of org scope" }),
        };
      }
    }

    if (!isAdminOrSuper(actorRole as any)) {
      if (!userId)
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - user id required" }),
        };

      if (!actorIsActive) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - user is not active" }),
        };
      }

      // Demo org members can trigger any demo system. Real-org members
      // need explicit access.
      const isDemoOrgViewer = systemOrgId === DEMO_ORG_ID;
      if (!isDemoOrgViewer && !actorAllowed.includes(systemId)) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: "forbidden - no access to system" }),
        };
      }
    }

    const deploymentMode = resolveDeploymentMode(
      system.url,
      system.deploymentMode,
    );
    const recheckEnabled = shouldUseRenderWakeupWorkflow(
      system.url,
      system.deploymentMode,
    );
    const delayedRecheckSeconds = recheckEnabled
      ? Number(process.env.RENDER_WAKEUP_DELAY_SECONDS || 90)
      : 0;

    const queuedMessage: HealthCheckQueueMessage = {
      systemId,
      attempt: 1,
      requestedBy: userId,
      requestedAt: new Date().toISOString(),
    };

    if (dispatchMode === "sqs") {
      const queueUrl = process.env.HEALTH_CHECK_QUEUE_URL;
      if (!queueUrl) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ message: "HEALTH_CHECK_QUEUE_URL not set" }),
        };
      }

      await enqueueHealthCheck(queuedMessage, 0);
    } else {
      await invokeHealthWorker(queuedMessage);
    }

    return {
      statusCode: 202,
      headers,
      body: JSON.stringify({
        status: 202,
        transport: dispatchMode,
        message: recheckEnabled
          ? "Health check queued. Automatic wake-up recheck is enabled for this Render system."
          : "Health check queued. Standard single-pass check is enabled for this system.",
        data: {
          systemId,
          deploymentMode,
          attempt: 1,
          recheckEnabled,
          delayedRecheckSeconds,
        },
      }),
    };
  } catch (error) {
    console.error("trigger-health error:", error);
    return handleError(error);
  }
};
