// SaaS roles:
// - superadmin: platform-wide; cross-org visibility; reserved for the
//   platform owner. Hidden from normal UI flows.
// - admin: organization owner / org admin. Created by self-serve
//   registration. Manages users + systems within their org.
// - user: organization member, scoped access to assigned systems.
// - tester: legacy alias for `user`. Kept to preserve old seed data and
//   any account that existed before the SaaS migration. Functionally
//   identical to `user`.
export const USER_ROLES = ["superadmin", "admin", "user", "tester"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["Active", "Pending", "Suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

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
   * True when this is a throwaway demo session user. Demo users
   * inherit demo-org permissions but are blocked from destructive
   * actions (delete user, delete system).
   */
  demoMode?: boolean;
  /**
   * Demo accounts auto-expire. Seconds-since-epoch. Backed by the
   * table TTL field `expiresAt` for cleanup.
   */
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

/**
 * Roles that are functionally equivalent to a regular org member.
 * Used by RBAC + filtering to treat legacy `tester` records as `user`.
 */
export const ORG_MEMBER_ROLES: UserRole[] = ["user", "tester"];

export const isOrgMemberRole = (role?: UserRole | string): boolean =>
  ORG_MEMBER_ROLES.includes(role as UserRole);
