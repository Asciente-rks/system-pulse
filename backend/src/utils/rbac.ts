import type { UserRole } from "../types/user.js";

const roleHierarchy: Record<UserRole, UserRole[]> = {
  superadmin: ["superadmin", "admin", "tester"],
  admin: ["tester"],
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
