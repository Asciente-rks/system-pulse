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

// Trim leading/trailing whitespace and collapse consecutive spaces so
// the persisted value can't be padded with hidden whitespace
// (defense against display spoofing and DDB/email rendering quirks).
const collapseWhitespace = (value: unknown): unknown =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value;

export const fullNameYup = yup
  .string()
  .transform(collapseWhitespace)
  .required("Full name is required")
  .min(3, "Name too short")
  .max(80, "Name too long")
  .matches(
    /^[\p{L}\p{M}\s'.\-]+$/u,
    "Name may only contain letters, spaces, apostrophes, dots, and hyphens",
  );

export const orgNameYup = yup
  .string()
  .transform(collapseWhitespace)
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
  // Bounded so a malicious actor can't make us run scrypt over a
  // multi-MB string. The cap is well above the practical limit
  // imposed by `passwordYup` (128 chars) at the create side.
  password: yup
    .string()
    .required("Password is required")
    .max(256, "Password is too long"),
});

export const forgotPasswordSchema = yup.object({
  email: emailYup,
});

export const resetPasswordSchema = yup.object({
  // Reset tokens are server-issued UUIDs; cap to keep DDB queries
  // fast and prevent abuse.
  token: yup
    .string()
    .required("Reset token is required")
    .max(128, "Reset token is too long"),
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
