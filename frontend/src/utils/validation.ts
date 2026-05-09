import * as yup from "yup";
import validator from "validator";

/**
 * Shared password rules. Mirrors backend `passwordYup` exactly so the
 * UI feedback matches what the API will accept. Built on `validator`
 * for consistency across all password-bearing flows.
 */
export const passwordYup = yup
  .string()
  .required("Password is required")
  .test(
    "password-strength",
    "Password must be 8-128 chars with lowercase, uppercase, number, and symbol",
    (value) =>
      typeof value === "string" &&
      value.length <= 128 &&
      validator.isStrongPassword(value, {
        minLength: 8,
        minLowercase: 1,
        minUppercase: 1,
        minNumbers: 1,
        minSymbols: 1,
      }),
  );

export const emailYup = yup
  .string()
  .required("Email is required")
  .test("is-email", "Invalid email format", (value) =>
    typeof value === "string" &&
    validator.isEmail(value, { allow_display_name: false }),
  )
  .transform((value) =>
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

export const loginSchema = yup.object({
  email: emailYup,
  password: yup.string().required("Password is required"),
});

/**
 * Convenience: turn a yup ValidationError into a `{ field: message }`
 * map so React forms can display per-field messages.
 */
export const fieldErrors = (
  error: unknown,
): Record<string, string> => {
  if (!(error instanceof yup.ValidationError)) {
    return {};
  }
  const map: Record<string, string> = {};
  for (const inner of error.inner.length ? error.inner : [error]) {
    if (inner.path && !map[inner.path]) {
      map[inner.path] = inner.message;
    }
  }
  return map;
};
