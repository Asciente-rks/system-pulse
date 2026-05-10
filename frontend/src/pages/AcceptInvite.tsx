import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { acceptInvite } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import PasswordChecklist, {
  isPasswordStrong,
} from "../components/PasswordChecklist";
import { fieldErrors, setupPasswordSchema } from "../utils/validation";

export default function AcceptInvite() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  // CRITICAL — if the inviter (e.g. the org owner) is signed in on
  // this same browser when the invitee opens the email link, the
  // SPA would otherwise silently treat the invitee as the inviter
  // (auto-redirecting them to the inviter's dashboard after their
  // password is set). Clear any existing session before rendering
  // the form so the only path forward is a fresh login.
  useEffect(() => {
    signOut();
    // Also nuke any stray session cache to be safe.
    try {
      localStorage.removeItem("systemPulseSession");
    } catch {}
  }, [signOut]);

  const queryToken = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }, []);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Token comes from the URL the invite email links to. Never shown
  // or copy-pasted by the user — keeps it off-screen, off-clipboard.
  const tokenMissing = queryToken.length === 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);

    if (tokenMissing) {
      setErrorMessage(
        "Invite link is missing its token. Open the link from your invitation email again.",
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

    setSubmitting(true);
    try {
      const response = await acceptInvite(
        queryToken,
        password,
        confirmPassword,
      );

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
    !tokenMissing &&
    isPasswordStrong(password) &&
    password === confirmPassword;

  return (
    <section className="auth-wrap">
      <div className="auth-hero">
        <p className="auth-kicker">System Pulse</p>
        <h1 className="auth-title">Accept invitation</h1>
        <p className="auth-copy">
          Set your account password to activate access. The invitation token
          in your email link is consumed automatically.
        </p>
      </div>

      <form className="auth-card" onSubmit={submit}>
        <h2 className="panel-title">Set your password</h2>

        {tokenMissing && (
          <div className="status-error" role="alert">
            This page expects an invite token in the URL. Please open the
            link from your invitation email.
          </div>
        )}

        <div className="form-field">
          <label className="field-label">Password</label>
          <input
            type="password"
            className="field-input"
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
          <label className="field-label">Confirm password</label>
          <input
            type="password"
            className="field-input"
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
