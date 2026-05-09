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

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    signOut();
  }, [signOut]);

  // Token is taken straight from the URL the email links to. We
  // never show or store it in the UI — that prevents shoulder-surf
  // capture and stops users copy-pasting it into the wrong place.
  const tokenMissing = queryToken.length === 0;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    if (tokenMissing) {
      setErrorMessage(
        "Reset link is missing its token. Open the link from your email again.",
      );
      return;
    }

    try {
      await setupPasswordSchema.validate(
        { token: queryToken, password, confirmPassword },
        { abortEarly: false, stripUnknown: true },
      );
      setErrors({});
    } catch (validationError) {
      setErrors(fieldErrors(validationError));
      return;
    }

    setLoading(true);
    try {
      const response = await resetPassword(
        queryToken,
        password,
        confirmPassword,
      );

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
    !tokenMissing &&
    isPasswordStrong(password) &&
    password === confirmPassword;

  return (
    <section className="auth-wrap">
      <div className="auth-hero">
        <p className="auth-kicker">System Pulse</p>
        <h1 className="auth-title">Reset password</h1>
        <p className="auth-copy">
          Set a new password before the reset link expires. The token in your
          email link is consumed automatically — you don't have to copy it
          anywhere.
        </p>
      </div>

      <form className="auth-card" onSubmit={onSubmit}>
        <h2 className="panel-title">Set new password</h2>

        {tokenMissing && (
          <div className="status-error" role="alert">
            This page expects a token in the URL. Please open the link from
            your password-reset email.
          </div>
        )}

        <div className="form-field">
          <label className="field-label">New password</label>
          <input
            className="field-input"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            disabled={tokenMissing}
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
            disabled={tokenMissing}
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
