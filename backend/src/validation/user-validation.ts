import * as yup from "yup";
import { USER_ROLES, USER_STATUSES } from "../types/user.js";

export const createUserSchema = yup.object({
  email: yup
    .string()
    .email("Invalid email format")
    .required("Email is required"),
  full_name: yup
    .string()
    .min(3, "Name too short")
    .required("Full name is required"),
  role: yup
    .mixed()
    .oneOf([...USER_ROLES])
    .required("Role is required"),
  status_: yup
    .mixed()
    .oneOf([...USER_STATUSES])
    .default("Pending"),
});

export const setupPasswordSchema = yup.object({
  password: yup
    .string()
    .required("Password is required")
    .min(8, "Password must be at least 8 characters")
    .matches(/[a-z]/, "Password must contain at least one lowercase letter")
    .matches(/[A-Z]/, "Password must contain at least one uppercase letter")
    .matches(/[0-9]/, "Password must contain at least one number")
    .matches(
      /[@$!%*?&]/,
      "Password must contain at least one special character (@$!%*?&)",
    ),

  confirmPassword: yup
    .string()
    .oneOf([yup.ref("password")], "Passwords must match"),
});

export const updateUserSchema = yup.object({
  email: yup.string().email(),
  full_name: yup.string().min(3),
  role: yup.mixed().oneOf([...USER_ROLES]),
  status_: yup.mixed().oneOf([...USER_STATUSES]),
});
