import * as yup from "yup";
import validator from "validator";
import { USER_ROLES, USER_STATUSES } from "../types/user.js";

/**
 * Centralised password rules. Built on top of `validator` so all
 * password-bearing flows (register, accept-invite, reset-password,
 * create-user) share the exact same standard.
 *
 * Rules:
 *  - 8..128 chars
 *  - at least 1 lowercase, 1 uppercase, 1 number, 1 symbol
 */
export const passwordYup = yup
  .string()
  .required("Password is required")
  .test(
    "password-strength",
    "Password must be 8-128 chars and include lowercase, uppercase, number, and symbol",
    (value) =>
      typeof value === "string" &&
      validator.isStrongPassword(value, {
        minLength: 8,
        minLowercase: 1,
        minUppercase: 1,
        minNumbers: 1,
        minSymbols: 1,
      }) &&
      value.length <= 128,
  );

/**
 * Centralised email rule. Uses `validator.isEmail` for stricter
 * checks than yup's default (catches IDN edge cases, blocks display
 * names, etc.).
 */
export const emailYup = yup
  .string()
  .required("Email is required")
  .test("is-email", "Invalid email format", (value) =>
    typeof value === "string" && validator.isEmail(value, { allow_display_name: false }),
  )
  .transform((value: unknown) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  );

export const fullNameYup = yup
  .string()
  .required("Full name is required")
  .min(3, "Name too short")
  .max(80, "Name too long")
  .matches(
    /^[\p{L}\p{M}\s'.\-]+$/u,
    "Name may only contain letters, spaces, apostrophes, dots, and hyphens",
  );

export const orgNameYup = yup
  .string()
  .required("Organization name is required")
  .min(2, "Organization name too short")
  .max(60, "Organization name too long")
  .matches(
    /^[\p{L}\p{N}\s'.\-&]+$/u,
    "Organization name may only contain letters, numbers, spaces, and basic punctuation",
  );

export const otpYup = yup
  .string()
  .required("OTP is required")
  .matches(/^[0-9]{6}$/, "OTP must be a 6-digit code");

// ---- existing shapes, kept compatible ----

export const createUserSchema = yup.object({
  email: emailYup,
  full_name: fullNameYup,
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
  password: passwordYup,
  confirmPassword: yup
    .string()
    .oneOf([yup.ref("password")], "Passwords must match"),
});

export const updateUserSchema = yup.object({
  email: emailYup.notRequired(),
  full_name: fullNameYup.notRequired(),
  role: yup.mixed().oneOf([...USER_ROLES]),
  status_: yup.mixed().oneOf([...USER_STATUSES]),
});

export const loginSchema = yup.object({
  email: emailYup,
  password: yup.string().required("Password is required"),
});

export const forgotPasswordSchema = yup.object({
  email: emailYup,
});

export const resetPasswordSchema = yup.object({
  token: yup.string().required("Reset token is required"),
  password: passwordYup,
  confirmPassword: yup
    .string()
    .oneOf([yup.ref("password")], "Passwords must match"),
});

// ---- new SaaS shapes ----

export const registerStartSchema = yup.object({
  email: emailYup,
  password: passwordYup,
  confirmPassword: yup
    .string()
    .oneOf([yup.ref("password")], "Passwords must match"),
  full_name: fullNameYup,
  org_name: orgNameYup,
});

export const registerVerifySchema = yup.object({
  email: emailYup,
  otp: otpYup,
});

export const registerResendSchema = yup.object({
  email: emailYup,
});

export const demoStartSchema = yup.object({
  role: yup
    .mixed<"admin" | "user">()
    .oneOf(["admin", "user"])
    .default("admin"),
  display_name: yup
    .string()
    .min(2, "Name too short")
    .max(40, "Name too long")
    .optional(),
});
