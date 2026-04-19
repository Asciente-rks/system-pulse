import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { resetPassword } from "../services/api";
import { useAuth } from "../hooks/useAuth";

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
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    signOut();
  }, [signOut]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setStatusMessage(null);

    try {
      const response = await resetPassword(token, password, confirmPassword);

      if (response._httpStatus >= 400) {
        setError(response.message || "Reset failed");
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

  return (
    <section className="auth-wrap">
      <div className="auth-hero">
        <p className="auth-kicker">System Pulse</p>
        <h1 className="auth-title">Reset Password</h1>
        <p className="auth-copy">
          Use your reset token to set a new password before eligibility expires.
        </p>
      </div>

      <form className="auth-card" onSubmit={onSubmit}>
        <h2 className="panel-title">Set New Password</h2>

        <div className="form-field">
          <label className="field-label">Reset Token</label>
          <input
            className="field-input"
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </div>

        <div className="form-field">
          <label className="field-label">New Password</label>
          <input
            className="field-input"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <div className="form-field">
          <label className="field-label">Confirm New Password</label>
          <input
            className="field-input"
            type="password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>

        <button className="btn btn-primary" disabled={loading}>
          {loading ? "Saving..." : "Reset Password"}
        </button>

        {error && <p className="status-error">{error}</p>}
        {statusMessage && <p className="status-note">{statusMessage}</p>}

        <p className="panel-copy">
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </section>
  );
}
