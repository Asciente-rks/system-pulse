import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import logoDark from "../../assets/With_Name_Dark.png";
import logoLight from "../../assets/With_Name_Light.png";

export default function Login() {
  const navigate = useNavigate();
  const { user, signIn } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    if (user.role === "tester") {
      navigate("/tester", { replace: true });
      return;
    }

    navigate("/admin", { replace: true });
  }, [navigate, user]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await login(email, password);

      if (response._httpStatus !== 200 || !response.data) {
        setError(response.message || "Login failed");
        return;
      }

      signIn(response.data);

      if (response.data.role === "tester") {
        navigate("/tester", { replace: true });
      } else {
        navigate("/admin", { replace: true });
      }
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
          className="auth-brand-art auth-brand-art-login"
        />
        <p className="auth-kicker">System Pulse</p>
        <h1 className="auth-title">Production Health Control</h1>
        <p className="auth-copy">
          Sign in with your invited account. Admins manage systems and access;
          testers run checks for assigned systems.
        </p>
      </div>

      <form className="auth-card" onSubmit={onSubmit}>
        <h2 className="panel-title">Login</h2>

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

        <div className="form-field">
          <label className="field-label">Password</label>
          <input
            className="field-input"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <button className="btn btn-primary" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>

        {error && <p className="status-error">{error}</p>}

        <p className="panel-copy">
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
      </form>
    </section>
  );
}
