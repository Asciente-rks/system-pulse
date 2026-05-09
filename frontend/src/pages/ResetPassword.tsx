import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { resetPassword } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import PasswordChecklist, {
  isPasswordStrong,
} from "../components/PasswordChecklist";
import { fieldErrors, setupPasswordSchema } from "../utils/validation";

export default function ResetPassword() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const queryToken = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }, []);

  const [token, setToken] = useState(queryToken);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    signOut();
  }, [signOut]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

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

    setLoading(true);
    try {
      const response = await resetPassword(token, password, confirmPassword);

      if (response._httpStatus >= 400) {
        setErrorMessage(response.message || "Reset failed");
        return;
      }

      setStatusMessage(response.message || "Password reset successful");
      setTimeout(() => {
        navigate("/login", { replace: true });
      }, 1200);
    } finally {
      setLoading(false);
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
        <h1 className="auth-title">Reset password</h1>
        <p className="auth-copy">
          Use your reset token to set a new password before eligibility
          expires.
        </p>
      </div>

      <form className="auth-card" onSubmit={onSubmit}>
        <h2 className="panel-title">Set new password</h2>

        <div className="form-field">
          <label className="field-label">Reset token</label>
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
          <label className="field-label">New password</label>
          <input
            className="field-input"
            type="password"
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
          <label className="field-label">Confirm new password</label>
          <input
            className="field-input"
            type="password"
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
          className="btn btn-primary"
          disabled={loading || !canSubmit}
        >
          {loading ? "Saving..." : "Reset password"}
        </button>

        {errorMessage && <p className="status-error">{errorMessage}</p>}
        {statusMessage && <p className="status-note">{statusMessage}</p>}

        <p className="panel-copy">
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </section>
  );
}
