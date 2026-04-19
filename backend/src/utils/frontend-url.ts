import type { APIGatewayProxyEventHeaders } from "aws-lambda";

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeBaseUrl = (value?: string): string | null => {
  const trimmed = (value || "").trim();
  if (!trimmed || !isHttpUrl(trimmed)) {
    return null;
  }

  return trimmed.replace(/\/+$/g, "");
};

export const resolveFrontendBaseUrl = (
  headers?: APIGatewayProxyEventHeaders,
): string => {
  const configured = normalizeBaseUrl(process.env.FRONTEND_URL);
  if (configured) {
    return configured;
  }

  const originHeader = headers?.origin || headers?.Origin;
  const fromOrigin = normalizeBaseUrl(originHeader);
  if (fromOrigin) {
    return fromOrigin;
  }

  const refererHeader = headers?.referer || headers?.Referer;
  if (refererHeader) {
    try {
      const refererOrigin = new URL(refererHeader).origin;
      const fromReferer = normalizeBaseUrl(refererOrigin);
      if (fromReferer) {
        return fromReferer;
      }
    } catch {
      // Ignore invalid referer values and use fallback.
    }
  }

  return "http://localhost:5173";
};
