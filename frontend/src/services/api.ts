const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/g, "") ||
  "http://localhost:3000/dev";

function buildHeaders() {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const role = localStorage.getItem("role");
  const userId = localStorage.getItem("userId");

  if (role) h["x-inviter-role"] = role;
  if (userId) h["x-user-id"] = userId;

  return h;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T & { _httpStatus: number }> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(),
      ...(init.headers || {}),
    },
  });

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = { message: response.statusText };
  }

  const body =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : { data: parsed };

  return {
    ...body,
    _httpStatus: response.status,
  } as T & { _httpStatus: number };
}

export function getApiBaseUrl() {
  return API_BASE;
}

export async function inviteUser(payload: {
  email: string;
  full_name: string;
  role: "superadmin" | "admin" | "tester";
}) {
  return request<Record<string, unknown>>("/users/invite", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function acceptInvite(
  token: string,
  password: string,
  confirmPassword: string,
) {
  return request<Record<string, unknown>>("/users/invite/accept", {
    method: "POST",
    body: JSON.stringify({ token, password, confirmPassword }),
  });
}

export async function createSystem(payload: { name: string; url: string }) {
  return request<Record<string, unknown>>("/systems", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function assignSystemAccess(payload: {
  userId: string;
  systemIds: string[];
  status_?: "Active" | "Pending" | "Suspended";
}) {
  return request<Record<string, unknown>>(
    `/users/${encodeURIComponent(payload.userId)}/systems`,
    {
      method: "POST",
      body: JSON.stringify({
        userId: payload.userId,
        systemIds: payload.systemIds,
        status_: payload.status_,
      }),
    },
  );
}

export async function triggerHealth(systemId: string) {
  return request<Record<string, unknown>>(
    `/systems/${encodeURIComponent(systemId)}/trigger`,
    {
      method: "POST",
    },
  );
}

export async function getSystemLogs(systemId: string, limit = 20) {
  return request<Record<string, unknown>>(
    `/systems/${encodeURIComponent(systemId)}/logs?limit=${encodeURIComponent(String(limit))}`,
    {
      method: "GET",
    },
  );
}
