import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login, startDemo } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import logoDark from "../../assets/With_Name_Dark.png";
import logoLight from "../../assets/With_Name_Light.png";

type DevAccount = {
  label: string;
  email: string;
  password: string;
  role: string;
};

const DEV_ACCOUNTS: DevAccount[] = [
  {
    label: "Admin",
    email: "admin@example.local",
    password: "Password123!",
    role: "admin",
  },
  {
    label: "Tester",
    email: "tester@example.local",
    password: "Password123!",
    role: "tester",
  },
];

export default function Login() {
  const navigate = useNavigate();
  const { user, signIn } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }

    if (user.role === "tester" || user.role === "user") {
      navigate("/tester", { replace: true });
      return;
    }

    navigate("/admin", { replace: true });
  }, [navigate, user]);

  async function performLogin(
    candidateEmail: string,
    candidatePassword: string,
  ): Promise<void> {
    setLoading(true);
    setError(null);
    setStatusMessage(null);

    try {
      const response = await login(candidateEmail, candidatePassword);

      if (response._httpStatus === 429) {
        setError("Too many login attempts. Please wait a moment.");
        return;
      }

      if (response._httpStatus === 401) {
        setError("Invalid email or password.");
        return;
      }

      if (response._httpStatus !== 200 || !response.data) {
        setError(response.message || "Login failed");
        return;
      }

      signIn(response.data);

      if (response.data.role === "tester" || response.data.role === "user") {
        navigate("/tester", { replace: true });
      } else {
        navigate("/admin", { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }

  async function startDemoSession(role: "admin" | "user") {
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    setDemoOpen(false);

    try {
      const response = await startDemo({
        role,
        display_name: role === "admin" ? "Demo Admin" : "Demo Tester",
      });

      if (response._httpStatus !== 201 || !response.data) {
        setError(response.message || "Could not start demo session");
        return;
      }

      const demoUser = response.data.user;
      signIn(demoUser);
      setStatusMessage(
        `Demo started. Session expires in about ${Math.round(
          (response.data.ttlSeconds || 0) / 60,
        )} minutes.`,
      );

      if (demoUser.role === "user" || demoUser.role === "tester") {
        navigate("/tester", { replace: true });
      } else {
        navigate("/admin", { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    await performLogin(email, password);
  }

  function handleDevPick(account: DevAccount) {
    setEmail(account.email);
    setPassword(account.password);
    setDevOpen(false);
    void performLogin(account.email, account.password);
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
          Sign in to your organization. New here? Create a free workspace in a
          minute, or jump into demo mode to explore real systems with safety
          guards.
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
        {statusMessage && <p className="status-note">{statusMessage}</p>}

        <div className="button-row" style={{ marginTop: "0.75rem" }}>
          <Link to="/register" className="btn btn-muted">
            Sign up
          </Link>
          <button
            type="button"
            className="btn btn-accent"
            disabled={loading}
            onClick={() => setDemoOpen((value) => !value)}
          >
            Try demo mode
          </button>
        </div>

        <p className="panel-copy">
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
      </form>

      {demoOpen && (
        <div
          className="dev-quick-popover"
          role="dialog"
          aria-modal="true"
          aria-label="Demo Mode"
        >
          <button
            type="button"
            className="dev-quick-close"
            onClick={() => setDemoOpen(false)}
            aria-label="Close demo mode picker"
          >
            ✕
          </button>
          <div className="dev-quick-header">
            <h3 className="dev-quick-title">Demo mode</h3>
            <span className="dev-quick-tag">read-mostly</span>
          </div>
          <p className="dev-quick-help">
            Browse real systems with destructive actions disabled. Pick a
            persona to start a temporary session.
          </p>
          <div className="dev-quick-list">
            <button
              type="button"
              className="dev-quick-option"
              disabled={loading}
              onClick={() => startDemoSession("admin")}
            >
              <span className="dev-quick-role">Admin</span>
              <code className="dev-quick-email">create + invite + monitor</code>
            </button>
            <button
              type="button"
              className="dev-quick-option"
              disabled={loading}
              onClick={() => startDemoSession("user")}
            >
              <span className="dev-quick-role">User</span>
              <code className="dev-quick-email">trigger + view logs</code>
            </button>
          </div>
        </div>
      )}

      {demoOpen && (
        <div
          className="dev-quick-backdrop"
          onClick={() => setDemoOpen(false)}
        />
      )}

      <button
        type="button"
        className="dev-quick-btn"
        onClick={() => setDevOpen((value) => !value)}
        title="Dev Tools"
        aria-label="Dev Tools"
      >
        <span className="dev-quick-icon">⚙</span>
        <span>Dev Tools</span>
      </button>

      {devOpen && (
        <div
          className="dev-quick-popover"
          role="dialog"
          aria-modal="true"
          aria-label="Dev Tools"
        >
          <button
            type="button"
            className="dev-quick-close"
            onClick={() => setDevOpen(false)}
            aria-label="Close Dev Tools"
          >
            ✕
          </button>
          <div className="dev-quick-header">
            <h3 className="dev-quick-title">Dev Tools</h3>
            <span className="dev-quick-tag">demo</span>
          </div>
          <p className="dev-quick-help">
            Quick-login as a seeded account so portfolio reviewers don't have
            to type anything.
          </p>
          <div className="dev-quick-list">
            {DEV_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                className="dev-quick-option"
                disabled={loading}
                onClick={() => handleDevPick(account)}
              >
                <span className="dev-quick-role">{account.label}</span>
                <code className="dev-quick-email">{account.email}</code>
              </button>
            ))}
          </div>
        </div>
      )}

      {devOpen && (
        <div
          className="dev-quick-backdrop"
          onClick={() => setDevOpen(false)}
        />
      )}
    </section>
  );
}
