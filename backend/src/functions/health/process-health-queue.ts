import type { SQSBatchResponse, SQSHandler, SQSRecord } from "aws-lambda";
import { docClient } from "../../config/db.js";
import { createHealthService } from "../../services/health-service.js";
import { enqueueHealthCheck } from "../../services/queue-service.js";
import { publishHealthStatusEvent } from "../../services/notification-service.js";
import { archiveHealthLogToS3 } from "../../services/log-archive-service.js";
import type { HealthCheckQueueMessage } from "../../types/health-events.js";
import { shouldUseRenderWakeupWorkflow } from "../../utils/health-workflow.js";

const parseQueueMessage = (record: SQSRecord): HealthCheckQueueMessage => {
  const parsed = JSON.parse(record.body) as Partial<HealthCheckQueueMessage>;

  if (!parsed.systemId || typeof parsed.systemId !== "string") {
    throw new Error("Invalid queue payload: systemId is required");
  }

  const attempt =
    typeof parsed.attempt === "number" && parsed.attempt > 0
      ? parsed.attempt
      : 1;

  return {
    systemId: parsed.systemId,
    attempt,
    requestedAt: parsed.requestedAt || new Date().toISOString(),
    requestedBy: parsed.requestedBy,
  };
};

export const processHealthCheckQueue: SQSHandler = async (
  event,
): Promise<SQSBatchResponse> => {
  const tableName = process.env.SYSTEM_PULSE_TABLE;
  const wakeupDelaySeconds = Number(
    process.env.RENDER_WAKEUP_DELAY_SECONDS || 90,
  );

  if (!tableName) {
    throw new Error("SYSTEM_PULSE_TABLE is not configured");
  }

  const healthService = createHealthService(docClient, tableName);
  const failures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      const message = parseQueueMessage(record);
      const system = await healthService.getSystemById(message.systemId);

      if (!system) {
        console.warn(`System not found: ${message.systemId}`);
        continue;
      }

      const result = await healthService.runHealthCheck(system.id, system.url, {
        attempt: message.attempt,
        triggerSource:
          message.attempt > 1 ? "delayed-recheck" : "manual-trigger",
      });

      await archiveHealthLogToS3({
        systemId: system.id,
        checkedAt: result.lastChecked,
        payload: {
          systemId: system.id,
          systemName: system.name,
          systemUrl: system.url,
          status: result.status,
          checkedAt: result.lastChecked,
          responseCode: result.lastResponseCode,
          responseTimeMs: result.responseTimeMs,
          checkedUrl: result.checkedUrl,
          attempt: message.attempt,
          requestedBy: message.requestedBy,
          requestedAt: message.requestedAt,
        },
      });

      await publishHealthStatusEvent({
        systemId: system.id,
        systemName: system.name,
        systemUrl: system.url,
        status: result.status,
        attempt: message.attempt,
        checkedAt: result.lastChecked,
        responseCode: result.lastResponseCode,
        responseTimeMs: result.responseTimeMs,
        checkedUrl: result.checkedUrl,
      });

      const renderWakeupEnabled = shouldUseRenderWakeupWorkflow(
        system.url,
        (system as { deploymentMode?: string }).deploymentMode,
      );

      if (
        renderWakeupEnabled &&
        result.status !== "UP" &&
        message.attempt === 1
      ) {
        await enqueueHealthCheck(
          {
            systemId: system.id,
            attempt: 2,
            requestedAt: message.requestedAt,
            requestedBy: message.requestedBy,
          },
          wakeupDelaySeconds,
        );
      }
    } catch (error) {
      console.error("Queue processing failed", {
        messageId: record.messageId,
        error,
      });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
