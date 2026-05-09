import * as yup from "yup";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    body: Record<string, unknown> = {},
  ) {
    super(JSON.stringify(body));
  }
}

export const headers = {
  "content-type": "application/json",
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  "Pragma": "no-cache",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  // Keep this list in lock-step with frontend/src/services/api.ts:
  // every header the SPA sends must be allowed in preflight or the
  // browser will refuse the request.
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-user-id, x-inviter-role, x-org-id, x-demo-mode",
  "Access-Control-Max-Age": "600",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Server": "SystemPulse",
};

export const handleError = (e: unknown) => {
  if (e instanceof yup.ValidationError) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        errors: e.errors,
      }),
    };
  }

  if (e instanceof SyntaxError) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: "Invalid request body format",
      }),
    };
  }

  if (e instanceof HttpError) {
    return {
      statusCode: e.statusCode,
      headers,
      body: e.message,
    };
  }

  return {
    statusCode: 500,
    headers,
    body: JSON.stringify({
      status: 500,
      message: "Internal server error",
    }),
  };
};
