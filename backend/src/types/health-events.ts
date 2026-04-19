export interface HealthCheckQueueMessage {
  systemId: string;
  attempt: number;
  requestedBy?: string;
  requestedAt: string;
}

export interface HealthStatusEvent {
  systemId: string;
  systemName: string;
  systemUrl: string;
  status: "UP" | "DOWN" | "UNKNOWN";
  attempt: number;
  checkedAt: string;
  responseCode?: number;
  responseTimeMs?: number;
  checkedUrl?: string;
}
