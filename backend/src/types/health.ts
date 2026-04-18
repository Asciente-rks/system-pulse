export type HealthStatus = "UP" | "DOWN" | "UNKNOWN";

export interface HealthCheck {
  id: string;
  name: string;
  url: string;
  status?: HealthStatus;
  createDate: string;
  lastChecked?: string;
  lastResponseCode?: number;
  responseTimeMs?: number;
}

export interface CreateHealthInput extends Omit<
  HealthCheck,
  "id" | "createDate" | "status"
> {}

export interface UpdateHealthInput extends Partial<CreateHealthInput> {}
