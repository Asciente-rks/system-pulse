import type { UserRole } from "../types/user.js";

// Role hierarchy for invites and visibility. `user` is the new SaaS
// member role; `tester` remains as a legacy alias and is treated
// equivalently for invitation/listing purposes.
const roleHierarchy: Record<UserRole, UserRole[]> = {
  superadmin: ["superadmin", "admin", "user", "tester"],
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

export function isAdminOrSuper(role?: UserRole): boolean {
  return role === "admin" || role === "superadmin";
}

/**
 * Strict superadmin gate. Used by destructive endpoints (delete-user,
 * delete-system) where ordinary admins should NOT be allowed through, even
 * though they pass the more relaxed isAdminOrSuper check used by other
 * admin-tier endpoints.
 */
export function isSuperAdmin(role?: UserRole): boolean {
  return role === "superadmin";
}

export function canCreateAccount(role?: UserRole): boolean {
  return isAdminOrSuper(role);
}

/**
 * Org-scoped visibility check. Superadmin sees all orgs. Everyone else
 * is locked to their own org.
 */
export function canSeeOrg(
  actorRole: UserRole | undefined,
  actorOrgId: string | undefined,
  targetOrgId: string | undefined,
): boolean {
  if (actorRole === "superadmin") return true;
  if (!actorOrgId || !targetOrgId) return false;
  return actorOrgId === targetOrgId;
}
