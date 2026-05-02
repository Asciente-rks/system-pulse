import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { HealthCheck, CreateHealthInput } from "../types/health.js";
import { resolveDeploymentMode } from "../utils/health-workflow.js";

const SYSTEMS_PK = "SYSTEM";
const SK_PREFIX_SYSTEM = "SYS#";
const LOG_PK_PREFIX = "SYSTEM#";
const LOG_SK_PREFIX = "LOG#";

interface SystemRecord extends HealthCheck {
  PK: string;
  SK: string;
  entityType?: string;
}

export interface HealthProbeResult {
  status: "UP" | "DOWN" | "UNKNOWN";
  lastChecked: string;
  lastResponseCode?: number;
  responseTimeMs?: number;
  checkedUrl?: string;
  errorMessage?: string;
}

interface HealthLogRecord {
  PK: string;
  SK: string;
  entityType: "HEALTH_LOG";
  systemId: string;
  status: "UP" | "DOWN" | "UNKNOWN";
  checkedAt: string;
  responseCode?: number;
  responseTimeMs?: number;
  checkedUrl?: string;
  attempt: number;
  triggerSource: string;
  errorMessage?: string;
}

const persistHealthProbeResult = async (
  docClient: DynamoDBDocumentClient,
  tableName: string,
  id: string,
  result: HealthProbeResult,
): Promise<void> => {
  const status = result.status;

  if (status === "UP") {
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: SYSTEMS_PK, SK: `${SK_PREFIX_SYSTEM}${id}` },
        UpdateExpression:
          "SET #status = :status, lastChecked = :checked, lastResponseCode = :responseCode, responseTimeMs = :responseTime",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": status,
          ":checked": result.lastChecked,
          ":responseCode": result.lastResponseCode,
          ":responseTime": result.responseTimeMs,
        },
      }),
    );
    return;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: SYSTEMS_PK, SK: `${SK_PREFIX_SYSTEM}${id}` },
      UpdateExpression:
        "SET #status = :status, lastChecked = :checked REMOVE lastResponseCode, responseTimeMs",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": status,
        ":checked": result.lastChecked,
      },
    }),
  );
};

export const createHealthService = (
  docClient: DynamoDBDocumentClient,
  tableName: string,
) => {
  const getSystemById = async (id: string): Promise<HealthCheck | null> => {
    const result = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: SYSTEMS_PK, SK: `${SK_PREFIX_SYSTEM}${id}` },
      }),
    );

    return (result.Item as HealthCheck | undefined) || null;
  };

  const persistHealthLog = async (
    systemId: string,
    result: HealthProbeResult,
    attempt: number,
    triggerSource: string,
  ): Promise<void> => {
    if (process.env.ENABLE_HEALTH_LOGS === "false") {
      return;
    }

    const checkedAt = result.lastChecked;

    const logRecord: HealthLogRecord = {
      PK: `${LOG_PK_PREFIX}${systemId}`,
      SK: `${LOG_SK_PREFIX}${checkedAt}#${attempt}`,
      entityType: "HEALTH_LOG",
      systemId,
      status: result.status,
      checkedAt,
      responseCode: result.lastResponseCode,
      responseTimeMs: result.responseTimeMs,
      checkedUrl: result.checkedUrl,
      attempt,
      triggerSource,
      errorMessage: result.errorMessage,
    };

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: logRecord,
      }),
    );
  };

  const runHealthCheck = async (
    id: string,
    url: string,
    options?: {
      timeoutMs?: number;
      attempt?: number;
      triggerSource?: string;
      persist?: boolean;
    },
  ): Promise<HealthProbeResult> => {
    const timeoutMs = options?.timeoutMs ?? 5000;
    const attempt = options?.attempt ?? 1;
    const triggerSource = options?.triggerSource ?? "manual";
    const persist = options?.persist ?? true;

    const trimmed = url.replace(/\/+$/g, "");
    const candidates = [`${trimmed}/health`, trimmed];

    let responseCode: number | undefined;
    let responseTimeMs: number | undefined;
    let checkedUrl: string | undefined;
    let errorMessage: string | undefined;

    for (const candidate of candidates) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const start = Date.now();

      try {
        const response = await fetch(candidate, {
          method: "GET",
          signal: controller.signal,
        });

        clearTimeout(timeout);
        responseCode = response.status;
        responseTimeMs = Date.now() - start;
        checkedUrl = candidate;

        const status: "UP" | "DOWN" = response.ok ? "UP" : "DOWN";
        const now = new Date().toISOString();

        if (persist) {
          await persistHealthProbeResult(docClient, tableName, id, {
            status,
            lastChecked: now,
            lastResponseCode: responseCode,
            responseTimeMs,
            checkedUrl,
          });
        }

        const result: HealthProbeResult = {
          status,
          lastChecked: now,
          lastResponseCode: responseCode,
          responseTimeMs,
          checkedUrl,
        };

        if (persist) {
          await persistHealthLog(id, result, attempt, triggerSource);
        }
        return result;
      } catch (error) {
        clearTimeout(timeout);
        errorMessage = error instanceof Error ? error.message : "Unknown error";
      }
    }

    const now = new Date().toISOString();

    if (persist) {
      await persistHealthProbeResult(docClient, tableName, id, {
        status: "DOWN",
        lastChecked: now,
        checkedUrl,
        errorMessage,
      });
    }

    const failedResult: HealthProbeResult = {
      status: "DOWN",
      lastChecked: now,
      checkedUrl,
      errorMessage,
    };

    if (persist) {
      await persistHealthLog(id, failedResult, attempt, triggerSource);
    }
    return failedResult;
  };

  const listHealthLogs = async (
    systemId: string,
    limit = 20,
  ): Promise<HealthLogRecord[]> => {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": `${LOG_PK_PREFIX}${systemId}`,
          ":skPrefix": LOG_SK_PREFIX,
        },
        ScanIndexForward: false,
        Limit: Math.max(1, Math.min(limit, 100)),
      }),
    );

    return (response.Items as HealthLogRecord[] | undefined) || [];
  };

  return {
    getSystemById,

    async persistHealthCheckResult(
      id: string,
      result: HealthProbeResult,
    ): Promise<void> {
      await persistHealthProbeResult(docClient, tableName, id, result);
    },

    async createHealthCheck(input: CreateHealthInput): Promise<HealthCheck> {
      const id = uuidv4();
      const createDate = new Date().toISOString();
      const deploymentMode = resolveDeploymentMode(
        input.url,
        input.deploymentMode,
      );

      const item: HealthCheck = {
        id,
        ...input,
        deploymentMode,
        status: "UNKNOWN",
        createDate,
      };

      const record: SystemRecord = {
        ...item,
        PK: SYSTEMS_PK,
        SK: `${SK_PREFIX_SYSTEM}${id}`,
        entityType: "SYSTEM",
      };

      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: record,
        }),
      );

      try {
        const probe = await runHealthCheck(id, input.url, {
          attempt: 0,
          triggerSource: "system-create",
        });

        return {
          ...item,
          status: probe.status,
          lastChecked: probe.lastChecked,
          lastResponseCode: probe.lastResponseCode,
          responseTimeMs: probe.responseTimeMs,
        } as HealthCheck;
      } catch (e) {
        return item;
      }
    },

    runHealthCheck,

    listHealthLogs,
  };
};
