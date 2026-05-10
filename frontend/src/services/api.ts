const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/g, "") ||
  "http://localhost:3000/dev";

export type AuthRole =
  | "superadmin"
  | "owner"
  | "admin"
  | "user"
  | "tester";
export type DeploymentMode = "render" | "standard";
export type DeploymentModeInput = DeploymentMode | "auto";

export interface UserPermissions {
  canCreateUser: boolean;
  canDeleteUser: boolean;
  canUpdateUser: boolean;
  canCreateSystem: boolean;
  canDeleteSystem: boolean;
  canUpdateSystem: boolean;
  canTriggerHealthChecks: boolean;
  canViewLogs: boolean;
}

export const PERMISSION_KEYS: Array<keyof UserPermissions> = [
  "canCreateUser",
  "canDeleteUser",
  "canUpdateUser",
  "canCreateSystem",
  "canDeleteSystem",
  "canUpdateSystem",
  "canTriggerHealthChecks",
  "canViewLogs",
];

export const PERMISSION_LABELS: Record<keyof UserPermissions, string> = {
  canCreateUser: "Invite users",
  canDeleteUser: "Delete users",
  canUpdateUser: "Edit user permissions",
  canCreateSystem: "Add systems",
  canDeleteSystem: "Delete systems",
  canUpdateSystem: "Edit systems",
  canTriggerHealthChecks: "Trigger health checks",
  canViewLogs: "View health logs",
};

export const DEFAULT_PERMISSIONS_BY_ROLE: Record<AuthRole, UserPermissions> = {
  superadmin: {
    canCreateUser: true,
    canDeleteUser: true,
    canUpdateUser: true,
    canCreateSystem: true,
    canDeleteSystem: true,
    canUpdateSystem: true,
    canTriggerHealthChecks: true,
    canViewLogs: true,
  },
  owner: {
    canCreateUser: true,
    canDeleteUser: true,
    canUpdateUser: true,
    canCreateSystem: true,
    canDeleteSystem: true,
    canUpdateSystem: true,
    canTriggerHealthChecks: true,
    canViewLogs: true,
  },
  admin: {
    canCreateUser: true,
    canDeleteUser: false,
    canUpdateUser: true,
    canCreateSystem: true,
    canDeleteSystem: false,
    canUpdateSystem: true,
    canTriggerHealthChecks: true,
    canViewLogs: true,
  },
  user: {
    canCreateUser: false,
    canDeleteUser: false,
    canUpdateUser: false,
    canCreateSystem: false,
    canDeleteSystem: false,
    canUpdateSystem: false,
    canTriggerHealthChecks: true,
    canViewLogs: true,
  },
  tester: {
    canCreateUser: false,
    canDeleteUser: false,
    canUpdateUser: false,
    canCreateSystem: false,
    canDeleteSystem: false,
    canUpdateSystem: false,
    canTriggerHealthChecks: true,
    canViewLogs: true,
  },
};

export interface SessionUser {
  id: string;
  email: string;
  full_name: string;
  role: AuthRole;
  status_: "Active" | "Pending" | "Suspended";
  allowedSystemIds: string[];
  orgId?: string;
  orgName?: string;
  demoMode?: boolean;
  demoExpiresAt?: number;
  permissions?: UserPermissions;
  /** ISO timestamp the row was locked. null/undefined ⇒ unlocked. */
  lockedAt?: string | null;
  /** Failed-login counter (server-side authoritative). */
  failedLoginAttempts?: number;
  /** True for the demo-mode permission templates. Cannot log in. */
  isDemoTemplate?: boolean;
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
  orgId?: string;
}

function buildHeaders(includeJsonContentType: boolean) {
  const h: Record<string, string> = {};

  if (includeJsonContentType) {
    h["Content-Type"] = "application/json";
  }

  const role = localStorage.getItem("role");
  const userId = localStorage.getItem("userId");
  const orgId = localStorage.getItem("orgId");
  const demoMode = localStorage.getItem("demoMode");

  if (role) h["x-inviter-role"] = role;
  if (userId) h["x-user-id"] = userId;
  if (orgId) h["x-org-id"] = orgId;
  if (demoMode === "true") h["x-demo-mode"] = "true";

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
  role: AuthRole;
  permissions?: Partial<UserPermissions>;
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

export async function updateSystem(
  systemId: string,
  payload: {
    name?: string;
    url?: string;
    deploymentMode?: DeploymentModeInput;
  },
) {
  return request<Record<string, unknown>>(
    `/systems/${encodeURIComponent(systemId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
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

export async function updateUserPermissions(payload: {
  userId: string;
  systemIds?: string[];
  status_?: "Active" | "Pending" | "Suspended";
  permissions?: Partial<UserPermissions>;
  reason?: string;
  notes?: string;
}) {
  const body: Record<string, unknown> = {};
  if (payload.systemIds !== undefined) body.systemIds = payload.systemIds;
  if (payload.status_ !== undefined) body.status_ = payload.status_;
  if (payload.permissions !== undefined) body.permissions = payload.permissions;
  if (payload.reason !== undefined) body.reason = payload.reason;
  if (payload.notes !== undefined) body.notes = payload.notes;
  return request<Record<string, unknown>>(
    `/users/${encodeURIComponent(payload.userId)}/permissions`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export async function changeUserRole(payload: {
  userId: string;
  role: AuthRole;
}) {
  return request<Record<string, unknown>>(
    `/users/${encodeURIComponent(payload.userId)}/role`,
    {
      method: "POST",
      body: JSON.stringify({ role: payload.role }),
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

export async function listSystems(
  limit = 100,
  options?: { orgId?: string },
) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (options?.orgId) qs.set("orgId", options.orgId);
  return request<{ data?: { systems?: SystemSummary[] }; message?: string }>(
    `/systems?${qs.toString()}`,
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

export async function deleteUser(
  userId: string,
  actorPassword: string,
  options?: { reason?: string; notes?: string },
) {
  return request<{ message?: string; data?: { userId: string } }>(
    `/users/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        actorPassword,
        reason: options?.reason,
        notes: options?.notes,
      }),
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

// ---- SaaS: registration + demo mode ----

export interface RegisterStartPayload {
  email: string;
  password: string;
  confirmPassword: string;
  full_name: string;
  org_name: string;
}

export async function registerStart(payload: RegisterStartPayload) {
  return request<{
    message?: string;
    data?: { email: string; expiresInMinutes: number; devOtp?: string };
  }>("/auth/register/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function registerVerify(payload: {
  email: string;
  otp: string;
}) {
  return request<{
    message?: string;
    data?: {
      user: SessionUser;
      org: { id: string; name: string; createDate: string };
    };
  }>("/auth/register/verify", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function registerResend(email: string) {
  return request<{
    message?: string;
    data?: { email: string; expiresInMinutes: number; devOtp?: string };
  }>("/auth/register/resend", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function startDemo(payload: {
  role?: "admin" | "user";
  display_name?: string;
}) {
  return request<{
    message?: string;
    data?: { user: SessionUser; ttlSeconds: number };
  }>("/auth/demo", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---- Profile / "me" ----

export async function getMe() {
  return request<{ data?: SessionUser; message?: string }>("/me", {
    method: "GET",
  });
}

export async function updateMyName(payload: {
  full_name: string;
  password: string;
}) {
  return request<{ message?: string; data?: { full_name: string } }>(
    "/me/name",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function updateMyEmailStart(payload: {
  new_email: string;
  password: string;
}) {
  return request<{
    message?: string;
    data?: { expiresInMinutes: number; devOtp?: string };
  }>("/me/email/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateMyPassword(payload: {
  current_password: string;
  new_password: string;
  confirm_new_password: string;
}) {
  return request<{ message?: string }>("/me/password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateMyEmailVerify(payload: { otp: string }) {
  return request<{ message?: string; data?: { email: string } }>(
    "/me/email/verify",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

// ---- Org admin ----

export async function updateOrg(payload: { orgId: string; name: string }) {
  return request<{ message?: string; data?: { id: string; name: string } }>(
    `/orgs/${encodeURIComponent(payload.orgId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name: payload.name }),
    },
  );
}

export interface OrgSummary {
  id: string;
  name: string;
  slug?: string;
  ownerId?: string;
  ownerEmail?: string;
  ownerName?: string;
  isDemo?: boolean;
  createDate?: string;
  memberCount: number;
  systemCount: number;
  status_?: "Active" | "Suspended";
  suspendedReason?: string | null;
  suspendedNotes?: string | null;
  suspendedAt?: string | null;
}

// ---- Reason dropdown options shared between FE + BE ----

export const ORG_SUSPEND_REASONS = [
  "Policy violation",
  "Service abuse",
  "Payment overdue",
  "Security concern",
  "Inactive — preserve data",
  "Other",
] as const;

export const ORG_DELETE_REASONS = [
  "Owner requested deletion",
  "Policy violation - permanent",
  "Account migration",
  "Inactive cleanup",
  "Other",
] as const;

export const USER_SUSPEND_REASONS = [
  "Policy violation",
  "Inactive",
  "Security concern",
  "Temporary review",
  "Role change pending",
  "Other",
] as const;

export const USER_DELETE_REASONS = [
  "User requested deletion",
  "No longer with org",
  "Policy violation - permanent",
  "Duplicate account",
  "Other",
] as const;

export async function listOrgs() {
  return request<{
    data?: { orgs: OrgSummary[]; count: number };
    message?: string;
  }>("/orgs", {
    method: "GET",
  });
}

export async function suspendOrg(payload: {
  orgId: string;
  reason: string;
  notes?: string;
}) {
  return request<{ message?: string }>(
    `/orgs/${encodeURIComponent(payload.orgId)}/suspend`,
    {
      method: "POST",
      body: JSON.stringify({
        reason: payload.reason,
        notes: payload.notes,
      }),
    },
  );
}

export async function reactivateOrg(payload: {
  orgId: string;
  notes?: string;
}) {
  return request<{ message?: string }>(
    `/orgs/${encodeURIComponent(payload.orgId)}/unsuspend`,
    {
      method: "POST",
      body: JSON.stringify({ notes: payload.notes }),
    },
  );
}

export async function deleteOrg(payload: {
  orgId: string;
  actorPassword: string;
  reason: string;
  notes?: string;
}) {
  return request<{
    message?: string;
    data?: { id: string; usersDeleted: number; systemsDeleted: number };
  }>(`/orgs/${encodeURIComponent(payload.orgId)}`, {
    method: "DELETE",
    body: JSON.stringify({
      actorPassword: payload.actorPassword,
      reason: payload.reason,
      notes: payload.notes,
    }),
  });
}

// ---- Account lock ----

export async function unlockUser(payload: {
  userId: string;
  actorPassword: string;
}) {
  return request<{ message?: string; data?: { userId: string } }>(
    `/users/${encodeURIComponent(payload.userId)}/unlock`,
    {
      method: "POST",
      body: JSON.stringify({ actorPassword: payload.actorPassword }),
    },
  );
}

// ---- Permission helpers ----

export function resolveSessionPermissions(
  user: SessionUser | null | undefined,
): UserPermissions {
  if (!user) {
    return {
      canCreateUser: false,
      canDeleteUser: false,
      canUpdateUser: false,
      canCreateSystem: false,
      canDeleteSystem: false,
      canUpdateSystem: false,
      canTriggerHealthChecks: false,
      canViewLogs: false,
    };
  }
  if (user.role === "owner" || user.role === "superadmin") {
    return DEFAULT_PERMISSIONS_BY_ROLE[user.role];
  }
  const defaults = DEFAULT_PERMISSIONS_BY_ROLE[user.role] || DEFAULT_PERMISSIONS_BY_ROLE.user;
  return { ...defaults, ...(user.permissions || {}) };
}

export function userCan(
  user: SessionUser | null | undefined,
  key: keyof UserPermissions,
): boolean {
  return resolveSessionPermissions(user)[key] === true;
}
