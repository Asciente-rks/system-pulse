import {
  resolvePermissions,
  type UserPermissions,
  type UserRole,
} from "../types/user.js";

// Role hierarchy for invites and visibility. `owner` sits above
// `admin`; `user` and `tester` are equivalent floor roles.
const roleHierarchy: Record<UserRole, UserRole[]> = {
  superadmin: ["superadmin", "owner", "admin", "user", "tester"],
  owner: ["admin", "user", "tester"],
  admin: ["user", "tester"],
  user: [],
  tester: [],
};

export function canInviteRole(
  inviterRole: UserRole | undefined,
  targetRole: UserRole,
): boolean {
  if (!inviterRole) return false;
  const allowed = roleHierarchy[inviterRole] || [];
  return allowed.includes(targetRole);
}

export function isAdminTier(role?: UserRole): boolean {
  return role === "admin" || role === "owner" || role === "superadmin";
}

/**
 * Backwards-compatible alias retained so functions that already
 * import `isAdminOrSuper` keep working. Owners count as admins
 * for every endpoint that took this gate.
 */
export const isAdminOrSuper = isAdminTier;

export function isSuperAdmin(role?: UserRole): boolean {
  return role === "superadmin";
}

export function isOwner(role?: UserRole): boolean {
  return role === "owner" || role === "superadmin";
}

export function canCreateAccount(role?: UserRole): boolean {
  return isAdminTier(role);
}

export function canSeeOrg(
  actorRole: UserRole | undefined,
  actorOrgId: string | undefined,
  targetOrgId: string | undefined,
): boolean {
  if (actorRole === "superadmin") return true;
  if (!actorOrgId || !targetOrgId) return false;
  return actorOrgId === targetOrgId;
}

/**
 * Permission check. Owners and superadmins always pass. Other
 * actors need an explicit `true` on the requested key (defaults
 * applied via `resolvePermissions`).
 */
export function hasPermission(
  actor: { role?: UserRole | string; permissions?: Partial<UserPermissions> },
  key: keyof UserPermissions,
): boolean {
  const role = actor.role as UserRole | undefined;
  if (role === "owner" || role === "superadmin") return true;
  return resolvePermissions(actor)[key] === true;
}

/**
 * Hard-coded constraint: only owners can promote / demote, and they
 * cannot demote themselves out of being the owner without explicit
 * succession (handled by the promote endpoint).
 */
export function canChangeRole(
  actorRole: UserRole | undefined,
  targetRole: UserRole | undefined,
): boolean {
  if (actorRole === "superadmin") return true;
  if (actorRole !== "owner") return false;
  // Owners can demote/promote within their org but not touch other
  // owners or superadmins.
  return targetRole !== "superadmin";
}
