export type HealthStatus = "UP" | "DOWN" | "UNKNOWN";
export type DeploymentMode = "render" | "standard";
export type DeploymentModeInput = DeploymentMode | "auto";

export interface HealthCheck {
  id: string;
  name: string;
  url: string;
  deploymentMode?: DeploymentMode;
  status?: HealthStatus;
  createDate: string;
  lastChecked?: string;
  lastResponseCode?: number;
  responseTimeMs?: number;
}

export interface CreateHealthInput extends Omit<
  HealthCheck,
  "id" | "createDate" | "status" | "deploymentMode"
> {
  deploymentMode?: DeploymentModeInput;
}

export interface UpdateHealthInput extends Partial<CreateHealthInput> {}
