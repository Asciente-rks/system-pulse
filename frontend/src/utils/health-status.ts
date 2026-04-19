import type { SystemSummary } from "../services/api";

export type HealthStatus = "UP" | "DOWN" | "UNKNOWN";

export const normalizeHealthStatus = (
  value: unknown,
  lastResponseCode?: number,
): HealthStatus => {
  if (typeof value === "string") {
    const normalized = value.toUpperCase();
    if (
      normalized === "UP" ||
      normalized === "DOWN" ||
      normalized === "UNKNOWN"
    ) {
      return normalized;
    }
  }

  if (typeof lastResponseCode === "number") {
    return lastResponseCode >= 200 && lastResponseCode < 400 ? "UP" : "DOWN";
  }

  return "UNKNOWN";
};

export const getSystemHealthStatus = (system: SystemSummary): HealthStatus =>
  normalizeHealthStatus(system.status, system.lastResponseCode);

export const statusPillClassName = (status: HealthStatus): string => {
  if (status === "UP") {
    return "status-pill status-pill-up";
  }

  if (status === "DOWN") {
    return "status-pill status-pill-down";
  }

  return "status-pill status-pill-unknown";
};
