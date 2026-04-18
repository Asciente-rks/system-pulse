import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { HealthCheck, CreateHealthInput } from "../types/health.js";

const SYSTEM_PK = "SYSTEM";
const SK_PREFIX_SYSTEM = "SYS#";

interface SystemRecord extends HealthCheck {
  PK: string;
  SK: string;
  entityType?: string;
}

export const createHealthService = (
  docClient: DynamoDBDocumentClient,
  tableName: string,
) => {
  return {
    async createHealthCheck(input: CreateHealthInput): Promise<HealthCheck> {
      const id = uuidv4();
      const createDate = new Date().toISOString();

      const item: HealthCheck = {
        id,
        ...input,
        createDate,
      };

      const record: SystemRecord = {
        ...item,
        PK: SYSTEM_PK,
        SK: `${SK_PREFIX_SYSTEM}${id}`,
        entityType: SYSTEM_PK,
      };

      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: record,
        }),
      );

      try {
        const probe = await this.runHealthCheck(id, input.url);
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

    async runHealthCheck(
      id: string,
      url: string,
      timeoutMs = 5000,
    ): Promise<{
      status: "UP" | "DOWN" | "UNKNOWN";
      lastChecked?: string;
      lastResponseCode?: number;
      responseTimeMs?: number;
    }> {
      const trimmed = url.replace(/\/+$/g, "");
      const candidates = [`${trimmed}/health`, trimmed];

      let lastError: unknown = undefined;
      let responseCode: number | undefined = undefined;
      let timeMs: number | undefined = undefined;

      for (const u of candidates) {
        const controller = new AbortController();
        const signal = controller.signal;
        const start = Date.now();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(u, { method: "GET", signal });
          timeMs = Date.now() - start;
          responseCode = res.status;

          const status = res.ok ? "UP" : "DOWN";

          const now = new Date().toISOString();
          await docClient.send(
            new UpdateCommand({
              TableName: tableName,
              Key: { PK: SYSTEM_PK, SK: `${SK_PREFIX_SYSTEM}${id}` },
              UpdateExpression:
                "SET #s = :s, lastChecked = :lc, lastResponseCode = :rc, responseTimeMs = :tm",
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: {
                ":s": status,
                ":lc": now,
                ":rc": responseCode,
                ":tm": timeMs,
              },
            }),
          );

          clearTimeout(timeout);
          return {
            status: status as "UP" | "DOWN",
            lastChecked: new Date().toISOString(),
            lastResponseCode: responseCode,
            responseTimeMs: timeMs,
          };
        } catch (err) {
          lastError = err;
          clearTimeout(timeout);
        }
      }

      // All attempts failed
      const now = new Date().toISOString();
      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: SYSTEM_PK, SK: `${SK_PREFIX_SYSTEM}${id}` },
          UpdateExpression: "SET #s = :s, lastChecked = :lc",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":s": "DOWN", ":lc": now },
        }),
      );

      return { status: "DOWN", lastChecked: now };
    },
  };
};
