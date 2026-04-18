export const USER_ROLES = ["superadmin", "admin", "tester"] as const;
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
}

export interface CreateUserInput extends Omit<User, "id" | "createDate"> {}

export interface UpdateUserInput extends Partial<
  Omit<User, "id" | "createDate">
> {}

export interface UserFilters {
  role?: UserRole;
  status_?: UserStatus;
  search?: string;
}
