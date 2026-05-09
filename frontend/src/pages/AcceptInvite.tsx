import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { acceptInvite } from "../services/api";
import PasswordChecklist, {
  isPasswordStrong,
} from "../components/PasswordChecklist";
import { fieldErrors, setupPasswordSchema } from "../utils/validation";

export default function AcceptInvite() {
  const navigate = useNavigate();

  const queryToken = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }, []);

  const [token, setToken] = useState(queryToken);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      await setupPasswordSchema.validate(
        { token, password, confirmPassword },
        { abortEarly: false, stripUnknown: true },
      );
      setErrors({});
    } catch (validationError) {
      setErrors(fieldErrors(validationError));
      return;
    }

    setSubmitting(true);
    try {
      const response = await acceptInvite(token, password, confirmPassword);

      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Could not activate your account"),
        );
        return;
      }

      setStatusMessage(
        String(
          response.message || "Account activated. Redirecting to login...",
        ),
      );
      setTimeout(() => navigate("/login", { replace: true }), 1200);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    token.length > 0 &&
    isPasswordStrong(password) &&
    password === confirmPassword;

  return (
    <section className="auth-wrap">
      <div className="auth-hero">
        <p className="auth-kicker">System Pulse</p>
        <h1 className="auth-title">Accept invitation</h1>
        <p className="auth-copy">
          Use your invite token to set your account password and activate
          access.
        </p>
      </div>

      <form className="auth-card" onSubmit={submit}>
        <h2 className="panel-title">Set your password</h2>

        <div className="form-field">
          <label className="field-label">Invite token</label>
          <input
            className="field-input"
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {errors.token && <p className="status-error">{errors.token}</p>}
        </div>

        <div className="form-field">
          <label className="field-label">Password</label>
          <input
            type="password"
            className="field-input"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
          <PasswordChecklist password={password} />
          {errors.password && (
            <p className="status-error">{errors.password}</p>
          )}
        </div>

        <div className="form-field">
          <label className="field-label">Confirm password</label>
          <input
            type="password"
            className="field-input"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
          />
          {confirmPassword.length > 0 && confirmPassword !== password && (
            <p className="status-error">Passwords do not match</p>
          )}
          {errors.confirmPassword && (
            <p className="status-error">{errors.confirmPassword}</p>
          )}
        </div>

        <button
          className="btn btn-success"
          disabled={submitting || !canSubmit}
        >
          {submitting ? "Activating..." : "Activate account"}
        </button>

        {statusMessage && <p className="status-note">{statusMessage}</p>}
        {errorMessage && <p className="status-error">{errorMessage}</p>}

        <p className="panel-copy">
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </section>
  );
}
