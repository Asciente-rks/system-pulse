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

export function canCreateAccount(role?: UserRole): boolean {
  return isAdminOrSuper(role);
}
