import type { SQSBatchResponse, SQSHandler, SQSRecord } from "aws-lambda";
import { docClient } from "../../config/db.js";
import { createHealthService } from "../../services/health-service.js";
import { publishHealthStatusEvent } from "../../services/notification-service.js";
import { enqueueHealthCheck } from "../../services/queue-service.js";
import type { HealthCheckQueueMessage } from "../../types/health-events.js";
import { shouldUseRenderWakeupWorkflow } from "../../utils/health-workflow.js";

const sleep = async (delayMs: number): Promise<void> => {
  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

// Hard caps on the queue message shape. SQS messages always come
// from our own producers (this codebase) so trust is high, but
// validating here means a malformed message can never cause an
// unbounded loop or oversized DDB write — it lands in the DLQ
// after maxReceiveCount.
const MAX_SYSTEM_ID_LEN = 200;
const MAX_REQUESTED_BY_LEN = 200;
const MAX_ATTEMPT = 10;

const parseQueueMessage = (record: SQSRecord): HealthCheckQueueMessage => {
  const parsed = JSON.parse(record.body) as Partial<HealthCheckQueueMessage>;

  if (
    !parsed.systemId ||
    typeof parsed.systemId !== "string" ||
    parsed.systemId.length > MAX_SYSTEM_ID_LEN
  ) {
    throw new Error("Invalid queue payload: systemId is required and must be reasonable length");
  }

  let attempt = 1;
  if (typeof parsed.attempt === "number" && parsed.attempt > 0) {
    attempt = Math.min(parsed.attempt, MAX_ATTEMPT);
  }

  let requestedBy: string | undefined;
  if (
    typeof parsed.requestedBy === "string" &&
    parsed.requestedBy.length > 0 &&
    parsed.requestedBy.length <= MAX_REQUESTED_BY_LEN
  ) {
    requestedBy = parsed.requestedBy;
  }

  let requestedAt: string;
  if (
    typeof parsed.requestedAt === "string" &&
    parsed.requestedAt.length > 0 &&
    parsed.requestedAt.length <= 64
  ) {
    requestedAt = parsed.requestedAt;
  } else {
    requestedAt = new Date().toISOString();
  }

  return {
    systemId: parsed.systemId,
    attempt,
    requestedAt,
    requestedBy,
  };
};

/**
 * Render-wakeup recheck strategy.
 *
 * Original behaviour: this Lambda did `await sleep(90s)` then
 * recheck — billed for the full 90 seconds while idle.
 *
 * Optimised behaviour: re-enqueue with `DelaySeconds` so the Lambda
 * exits cleanly and a fresh invocation picks the recheck up. Total
 * billed compute drops from ~95s to ~10s per Render-system probe.
 *
 * Gates:
 *   - `HEALTH_RECHECK_VIA_SQS=false`  → force sleep fallback
 *   - `HEALTH_CHECK_QUEUE_URL` unset  → no queue, sleep fallback
 *   - `ENABLE_QUEUE_WORKER_MAPPING=true` → queue → worker mapping
 *      is wired, so re-enqueued messages will actually run. Without
 *      this, the recheck would land in the queue and never execute.
 */
const SHOULD_RECHECK_VIA_SQS = (): boolean => {
  if (process.env.HEALTH_RECHECK_VIA_SQS === "false") return false;
  if (!process.env.HEALTH_CHECK_QUEUE_URL) return false;
  // Without the event source mapping, re-enqueued messages never get
  // processed. Fall back to in-Lambda sleep instead of silently
  // black-holing the recheck.
  if (process.env.ENABLE_QUEUE_WORKER_MAPPING !== "true") return false;
  return true;
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

      // Pass the resolved deployment mode so the probe picks the
      // right HTTP timeout (Render systems get 15s instead of 5s
      // to absorb cold-start tail latency).
      const resolvedMode = renderWakeupEnabled ? "render" : "standard";

      const initialResult = await healthService.runHealthCheck(
        system.id,
        system.url,
        {
          attempt: message.attempt,
          triggerSource:
            message.attempt > 1 ? "delayed-recheck" : "manual-trigger",
          persist: !renderWakeupEnabled || message.attempt > 1,
          deploymentMode: resolvedMode,
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

        if (SHOULD_RECHECK_VIA_SQS()) {
          // Re-enqueue with the wake-up delay; this Lambda exits cleanly.
          // SQS DelaySeconds maxes at 900s, our default is 90s.
          try {
            await enqueueHealthCheck(
              {
                systemId: system.id,
                attempt: 2,
                requestedAt: new Date().toISOString(),
                requestedBy: message.requestedBy,
              },
              Math.min(900, Math.max(0, wakeupDelaySeconds)),
            );
            continue;
          } catch (enqueueError) {
            console.warn(
              "Render-wakeup re-enqueue failed; falling back to in-Lambda sleep",
              enqueueError,
            );
            // fall through to legacy sleep path
          }
        }

        // Legacy / fallback path: sleep + recheck inside this Lambda.
        await sleep(wakeupDelaySeconds * 1000);

        const wakeupResult = await healthService.runHealthCheck(
          system.id,
          system.url,
          {
            attempt: 2,
            triggerSource: "delayed-recheck",
            deploymentMode: resolvedMode,
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
