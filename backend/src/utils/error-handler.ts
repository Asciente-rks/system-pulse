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
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-user-id, x-inviter-role",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

export const handleError = (e: unknown) => {
  console.log("handleerror", e);

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
        error: `invalid request body format: "${e.message}"`,
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
      error: e instanceof Error ? e.message : "Unknown Error",
    }),
  };
};
