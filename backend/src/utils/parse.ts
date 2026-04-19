export const parse = (body: unknown): Record<string, unknown> => {
  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    return JSON.parse(body) as Record<string, unknown>;
  }

  if (typeof body === "object") {
    return body as Record<string, unknown>;
  }

  return {};
};
