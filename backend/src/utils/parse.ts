import { HttpError } from "./error-handler.js";

// 256 KB request body cap. Lambda already enforces 6 MB at the
// platform level — this is a tighter, app-level guard against
// memory-bombing the JSON parser. The largest legitimate payload we
// have is `assignSystemAccess` with a list of system ids, which is
// well under this cap.
const MAX_BODY_BYTES = 256 * 1024;

export const parse = (body: unknown): Record<string, unknown> => {
  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    if (body.length > MAX_BODY_BYTES) {
      throw new HttpError(413, {
        status: 413,
        message: "Request body too large",
      });
    }
    return JSON.parse(body) as Record<string, unknown>;
  }

  if (typeof body === "object") {
    return body as Record<string, unknown>;
  }

  return {};
};
