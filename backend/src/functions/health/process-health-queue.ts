import type { SQSBatchResponse, SQSHandler, SQSRecord } from "aws-lambda";
import { docClient } from "../../config/db.js";
import { createHealthService } from "../../services/health-service.js";
import { publishHealthStatusEvent } from "../../services/notification-service.js";
import type { HealthCheckQueueMessage } from "../../types/health-events.js";
import { shouldUseRenderWakeupWorkflow } from "../../utils/health-workflow.js";

const sleep = async (delayMs: number): Promise<void> => {
  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

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

      const renderWakeupEnabled = shouldUseRenderWakeupWorkflow(
        system.url,
        (system as { deploymentMode?: string }).deploymentMode,
      );

      const initialResult = await healthService.runHealthCheck(
        system.id,
        system.url,
        {
          attempt: message.attempt,
          triggerSource:
            message.attempt > 1 ? "delayed-recheck" : "manual-trigger",
          persist: !renderWakeupEnabled || message.attempt > 1,
        },
      );

      if (renderWakeupEnabled && message.attempt === 1) {
        if (initialResult.status === "UP") {
          await healthService.persistHealthCheckResult(
            system.id,
            initialResult,
          );

          await publishHealthStatusEvent({
            systemId: system.id,
            systemName: system.name,
            systemUrl: system.url,
            status: initialResult.status,
            attempt: message.attempt,
            checkedAt: initialResult.lastChecked,
            responseCode: initialResult.lastResponseCode,
            responseTimeMs: initialResult.responseTimeMs,
            checkedUrl: initialResult.checkedUrl,
          });

          continue;
        }

        await sleep(wakeupDelaySeconds * 1000);

        const wakeupResult = await healthService.runHealthCheck(
          system.id,
          system.url,
          {
            attempt: 2,
            triggerSource: "delayed-recheck",
          },
        );

        await publishHealthStatusEvent({
          systemId: system.id,
          systemName: system.name,
          systemUrl: system.url,
          status: wakeupResult.status,
          attempt: 2,
          checkedAt: wakeupResult.lastChecked,
          responseCode: wakeupResult.lastResponseCode,
          responseTimeMs: wakeupResult.responseTimeMs,
          checkedUrl: wakeupResult.checkedUrl,
        });

        continue;
      }

      await publishHealthStatusEvent({
        systemId: system.id,
        systemName: system.name,
        systemUrl: system.url,
        status: initialResult.status,
        attempt: message.attempt,
        checkedAt: initialResult.lastChecked,
        responseCode: initialResult.lastResponseCode,
        responseTimeMs: initialResult.responseTimeMs,
        checkedUrl: initialResult.checkedUrl,
      });
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
