import React from "react";

// Match validator.isStrongPassword's symbol set exactly so the
// checklist on the client and the validation on the server agree:
// what looks green here will pass yup on the API.
//   https://github.com/validatorjs/validator.js/blob/master/src/lib/isStrongPassword.js
const SYMBOL_RE = /[\-#!$@£%^&*()_+|~=`{}\[\]:";'<>?,.\/ ]/;

const MIN_LEN = 8;
const MAX_LEN = 128;

export interface PasswordChecklistProps {
  password: string;
  /** Hide the bullet points until the user has typed at least one char. */
  hideUntilTyped?: boolean;
}

interface Rule {
  label: string;
  ok: boolean;
}

export function evaluatePasswordRules(password: string): Rule[] {
  return [
    {
      label: `${MIN_LEN}–${MAX_LEN} characters`,
      ok: password.length >= MIN_LEN && password.length <= MAX_LEN,
    },
    { label: "Lowercase letter (a–z)", ok: /[a-z]/.test(password) },
    { label: "Uppercase letter (A–Z)", ok: /[A-Z]/.test(password) },
    { label: "Number (0–9)", ok: /[0-9]/.test(password) },
    {
      label: "Symbol (e.g. ! @ # $ %)",
      ok: SYMBOL_RE.test(password),
    },
  ];
}

export function isPasswordStrong(password: string): boolean {
  return evaluatePasswordRules(password).every((rule) => rule.ok);
}

export default function PasswordChecklist({
  password,
  hideUntilTyped = false,
}: PasswordChecklistProps) {
  if (hideUntilTyped && password.length === 0) {
    return null;
  }

  const rules = evaluatePasswordRules(password);

  return (
    <ul
      className="password-checklist"
      aria-label="Password requirements"
      role="list"
    >
      {rules.map((rule) => (
        <li
          key={rule.label}
          className={`password-rule ${rule.ok ? "ok" : "pending"}`}
          aria-checked={rule.ok}
          role="checkbox"
        >
          <span className="password-rule-icon" aria-hidden="true">
            {rule.ok ? "✓" : "○"}
          </span>
          <span className="password-rule-label">{rule.label}</span>
        </li>
      ))}
    </ul>
  );
}
