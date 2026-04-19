export type DeploymentMode = "render" | "standard";
export type DeploymentModeInput = DeploymentMode | "auto";

const RENDER_HOST_MARKERS = ["onrender.com", "render.com"];

export const isRenderUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    return RENDER_HOST_MARKERS.some(
      (marker) => host === marker || host.endsWith(`.${marker}`),
    );
  } catch {
    return false;
  }
};

export const resolveDeploymentMode = (
  url: string,
  deploymentMode?: string,
): DeploymentMode => {
  if (deploymentMode === "render") {
    return "render";
  }

  if (deploymentMode === "standard") {
    return "standard";
  }

  return isRenderUrl(url) ? "render" : "standard";
};

export const shouldUseRenderWakeupWorkflow = (
  url: string,
  deploymentMode?: string,
): boolean => {
  return resolveDeploymentMode(url, deploymentMode) === "render";
};
