// SaaS roles:
// - superadmin: platform-wide; cross-org visibility; reserved for the
//   platform owner. Hidden from normal UI flows.
// - owner: org creator. One per org. Implicit "all permissions on";
//   can promote/demote anyone in their own org.
// - admin: org admin tier; permissions are explicit (see Permissions
//   below). The owner can grant/revoke any of these per-user.
// - user: org member, scoped access to assigned systems by default.
// - tester: legacy alias for `user`. Kept to preserve old seed data
//   and any account that existed before the SaaS migration.
//   Functionally identical to `user`.
export const USER_ROLES = [
  "superadmin",
  "owner",
  "admin",
  "user",
  "tester",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["Active", "Pending", "Suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Granular permissions held per-user. Independent of role tier so an
 * org owner can mix-and-match — e.g. promote a `user` to be able to
 * trigger systems but block them from creating systems.
 *
 * Promote/demote stays owner-only and is intentionally absent here:
 * the rbac layer hard-codes that check.
 */
export interface UserPermissions {
  /** Invite new users into the org. */
  canCreateUser: boolean;
  /** Permanently delete users. */
  canDeleteUser: boolean;
  /** Edit user metadata + system access + permissions. */
  canUpdateUser: boolean;
  /** Register new systems for monitoring. */
  canCreateSystem: boolean;
  /** Permanently delete systems. */
  canDeleteSystem: boolean;
  /** Edit system metadata (name, URL, mode). */
  canUpdateSystem: boolean;
  /** Trigger health checks on assigned systems. (Always true for owners). */
  canTriggerHealthChecks: boolean;
  /** Read system logs. */
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

/**
 * Default permission set per role. The owner has everything on at
 * all times (enforced in rbac.ts, not stored). Admins get the
 * "team-lead" baseline. Users / testers can only run tests on
 * systems they were granted access to.
 */
export const DEFAULT_PERMISSIONS_BY_ROLE: Record<UserRole, UserPermissions> = {
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

export const NULL_PERMISSIONS: UserPermissions = {
  canCreateUser: false,
  canDeleteUser: false,
  canUpdateUser: false,
  canCreateSystem: false,
  canDeleteSystem: false,
  canUpdateSystem: false,
  canTriggerHealthChecks: false,
  canViewLogs: false,
};

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status_: UserStatus;
  createDate: string;
  passwordHash?: string;
  allowedSystemIds?: string[];
  /**
   * Tenant the user belongs to. SaaS data isolation key.
   * `null` is only valid for the platform-level superadmin.
   */
  orgId?: string;
  /**
   * Granular permissions (see UserPermissions). Optional in storage
   * for backwards-compat; missing values are filled from
   * DEFAULT_PERMISSIONS_BY_ROLE at read time.
   */
  permissions?: Partial<UserPermissions>;
  /** True when this is a throwaway demo session user. */
  demoMode?: boolean;
  /** Demo accounts auto-expire. Backed by table TTL `expiresAt`. */
  demoExpiresAt?: number;
}

export interface CreateUserInput extends Omit<User, "id" | "createDate"> {}

export interface UpdateUserInput extends Partial<
  Omit<User, "id" | "createDate">
> {}

export interface UserFilters {
  role?: UserRole;
  status_?: UserStatus;
  search?: string;
  orgId?: string;
}

export const ORG_MEMBER_ROLES: UserRole[] = ["user", "tester"];

export const isOrgMemberRole = (role?: UserRole | string): boolean =>
  ORG_MEMBER_ROLES.includes(role as UserRole);

/**
 * Resolve the actual permissions for a user record, applying defaults
 * for missing fields. Owners and superadmins always get the full set
 * regardless of what's stored.
 */
export function resolvePermissions(user: {
  role?: UserRole | string;
  permissions?: Partial<UserPermissions>;
}): UserPermissions {
  const role = user.role as UserRole | undefined;
  if (role === "owner" || role === "superadmin") {
    return { ...DEFAULT_PERMISSIONS_BY_ROLE[role] };
  }

  const defaults =
    role && DEFAULT_PERMISSIONS_BY_ROLE[role]
      ? DEFAULT_PERMISSIONS_BY_ROLE[role]
      : NULL_PERMISSIONS;

  const stored = user.permissions || {};
  const merged: UserPermissions = { ...defaults };
  for (const key of PERMISSION_KEYS) {
    if (typeof stored[key] === "boolean") {
      merged[key] = stored[key] as boolean;
    }
  }
  return merged;
}
