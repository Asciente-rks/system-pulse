import validator from "validator";

/**
 * HTML-escape a user-supplied string for safe inclusion in email
 * bodies / HTML templates. React components auto-escape, but
 * nodemailer HTML templates do not — anywhere we interpolate user
 * input into raw HTML, route it through here.
 */
export const escapeForHtml = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return validator.escape(value);
};

/**
 * Trim + collapse whitespace + cap length. Used for free-form
 * display fields (full_name, org_name) before they're persisted.
 *
 * Note: yup already enforces character-class rules upstream — this
 * is a final scrub before storage rather than a primary defense.
 */
export const cleanDisplayString = (value: unknown, maxLength = 120): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, maxLength);
};

/**
 * Lowercase + trim email addresses for consistent storage.
 */
export const cleanEmail = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
};
