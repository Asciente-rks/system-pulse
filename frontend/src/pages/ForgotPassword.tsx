import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import logoDark from "../../assets/With_Name_Dark.png";
import logoLight from "../../assets/With_Name_Light.png";

export default function ForgotPassword() {
  const { signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    signOut();
  }, [signOut]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatusMessage(null);

    try {
      const response = await forgotPassword(email);
      setStatusMessage(
        response.message ||
          "If eligible, a password reset email has been sent to this address.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-wrap">
      <div className="auth-hero">
        <div className="auth-theme-toggle-wrap">
          <button className="btn btn-muted" onClick={toggleTheme}>
            {theme === "dark" ? "Light" : "Dark"} Mode
          </button>
        </div>
        <img
          src={theme === "dark" ? logoDark : logoLight}
          alt="System Pulse"
          className="auth-brand-art"
        />
        <p className="auth-kicker">System Pulse</p>
        <h1 className="auth-title">Forgot Password</h1>
        <p className="auth-copy">
          Enter your account email to request a password reset link. Eligibility
          is time-limited for security.
        </p>
      </div>

      <form className="auth-card" onSubmit={onSubmit}>
        <h2 className="panel-title">Request Reset Link</h2>

        <div className="form-field">
          <label className="field-label">Email</label>
          <input
            className="field-input"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <button className="btn btn-primary" disabled={loading}>
          {loading ? "Submitting..." : "Send Reset Email"}
        </button>

        {statusMessage && <p className="status-note">{statusMessage}</p>}

        <p className="panel-copy">
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </section>
  );
}
