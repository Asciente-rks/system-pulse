const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/g, "") ||
  "http://localhost:3000/dev";

export type AuthRole = "superadmin" | "admin" | "tester";
export type DeploymentMode = "render" | "standard";
export type DeploymentModeInput = DeploymentMode | "auto";

export interface SessionUser {
  id: string;
  email: string;
  full_name: string;
  role: AuthRole;
  status_: "Active" | "Pending" | "Suspended";
  allowedSystemIds: string[];
}

export interface SystemSummary {
  id: string;
  name: string;
  url: string;
  deploymentMode?: DeploymentMode;
  status?: "UP" | "DOWN" | "UNKNOWN";
  createDate: string;
  lastChecked?: string;
  lastResponseCode?: number;
  responseTimeMs?: number;
}

function buildHeaders(includeJsonContentType: boolean) {
  const h: Record<string, string> = {};

  if (includeJsonContentType) {
    h["Content-Type"] = "application/json";
  }

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
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...buildHeaders(Boolean(init.body)),
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    return {
      _httpStatus: 0,
      message:
        error instanceof Error
          ? error.message
          : "Network request failed. Check API URL and CORS setup.",
    } as unknown as T & { _httpStatus: number };
  }

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

export async function createSystem(payload: {
  name: string;
  url: string;
  deploymentMode?: DeploymentModeInput;
}) {
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

export async function login(email: string, password: string) {
  return request<{ data?: SessionUser; message?: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function forgotPassword(email: string) {
  return request<{ message?: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(
  token: string,
  password: string,
  confirmPassword: string,
) {
  return request<{ message?: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password, confirmPassword }),
  });
}

export async function listSystems(limit = 100) {
  return request<{ data?: { systems?: SystemSummary[] }; message?: string }>(
    `/systems?limit=${encodeURIComponent(String(limit))}`,
    {
      method: "GET",
    },
  );
}

export async function listUsers(limit = 100) {
  return request<{ data?: { users?: SessionUser[] }; message?: string }>(
    `/users?limit=${encodeURIComponent(String(limit))}`,
    {
      method: "GET",
    },
  );
}

export async function getUser(userId: string) {
  return request<{ data?: SessionUser; message?: string }>(
    `/users/${encodeURIComponent(userId)}`,
    {
      method: "GET",
    },
  );
}

export async function deleteUser(userId: string, actorPassword: string) {
  return request<{ message?: string; data?: { userId: string } }>(
    `/users/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ actorPassword }),
    },
  );
}

export async function deleteSystem(systemId: string, actorPassword: string) {
  return request<{ message?: string; data?: { systemId: string } }>(
    `/systems/${encodeURIComponent(systemId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ actorPassword }),
    },
  );
}
