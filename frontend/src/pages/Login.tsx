import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  forgotPassword,
  login,
  registerResend,
  registerStart,
  registerVerify,
  startDemo,
} from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import logoDark from "../../assets/With_Name_Dark.png";
import logoLight from "../../assets/With_Name_Light.png";
import PasswordChecklist, {
  isPasswordStrong,
} from "../components/PasswordChecklist";
import {
  fieldErrors,
  registerStartSchema,
  registerVerifySchema,
} from "../utils/validation";

type Tab = "signin" | "forgot" | "register";

const TAB_TO_PATH: Record<Tab, string> = {
  signin: "/login",
  forgot: "/forgot-password",
  register: "/register",
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "signin", label: "Sign in" },
  { id: "forgot", label: "Forgot" },
  { id: "register", label: "Sign up" },
];

interface LoginProps {
  defaultTab?: Tab;
}

interface RegisterFields {
  email: string;
  password: string;
  confirmPassword: string;
  full_name: string;
  org_name: string;
}

const INITIAL_REGISTER: RegisterFields = {
  email: "",
  password: "",
  confirmPassword: "",
  full_name: "",
  org_name: "",
};

type RegisterStage = "form" | "otp" | "success";

export default function Login({ defaultTab = "signin" }: LoginProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signIn } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Initial tab is derived from `defaultTab` (route-based) but the
  // user can switch freely between tabs without leaving /login.
  const [tab, setTab] = useState<Tab>(defaultTab);

  // ---- Sign in state ----
  const [signinEmail, setSigninEmail] = useState("");
  const [signinPassword, setSigninPassword] = useState("");
  const [signinError, setSigninError] = useState<string | null>(null);
  const [signinStatus, setSigninStatus] = useState<string | null>(null);

  // ---- Forgot password state ----
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotStatus, setForgotStatus] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);

  // ---- Register state ----
  const [regForm, setRegForm] = useState<RegisterFields>(INITIAL_REGISTER);
  const [regStage, setRegStage] = useState<RegisterStage>("form");
  const [regOtp, setRegOtp] = useState("");
  const [regErrors, setRegErrors] = useState<Record<string, string>>({});
  const [regStatus, setRegStatus] = useState<string | null>(null);
  const [regError, setRegError] = useState<string | null>(null);
  const [regOtpExpiresInMinutes, setRegOtpExpiresInMinutes] = useState<
    number | null
  >(null);
  const [regDevOtp, setRegDevOtp] = useState<string | null>(null);
  const [regCreatedOrgName, setRegCreatedOrgName] = useState<string | null>(
    null,
  );
  const [regResendCooldown, setRegResendCooldown] = useState(0);

  // ---- Shared loading + demo state ----
  const [loading, setLoading] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  // Authenticated users land on the right dashboard.
  useEffect(() => {
    if (!user) return;
    if (user.role === "tester" || user.role === "user") {
      navigate("/tester", { replace: true });
      return;
    }
    navigate("/admin", { replace: true });
  }, [navigate, user]);

  // Sync tab → URL so reload / browser nav remember position.
  useEffect(() => {
    const target = TAB_TO_PATH[tab];
    if (location.pathname !== target) {
      navigate(target, { replace: true });
    }
  }, [tab, location.pathname, navigate]);

  // Resend countdown.
  useEffect(() => {
    if (regResendCooldown <= 0) return;
    const id = window.setInterval(
      () => setRegResendCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [regResendCooldown]);

  const heroBlurb = useMemo(() => {
    if (tab === "signin") {
      return "Sign in to your organization.";
    }
    if (tab === "forgot") {
      return "Enter your email and we'll send a reset link if the account exists.";
    }
    return "Create a free workspace in a minute. Verify with a 6-digit code we email you.";
  }, [tab]);

  // ---------- handlers ----------
  async function performSignIn(email: string, password: string) {
    setLoading(true);
    setSigninError(null);
    setSigninStatus(null);
    try {
      const response = await login(email, password);
      if (response._httpStatus === 429) {
        setSigninError("Too many login attempts. Please wait a moment.");
        return;
      }
      // 423 Locked is the new lockout signal: account hit the max
      // failed-attempt threshold. The backend includes a contact-
      // your-supervisor message we can render verbatim.
      if (response._httpStatus === 423) {
        setSigninError(
          response.message ||
            "Account locked. Contact your supervisor or org admin to unlock.",
        );
        return;
      }
      if (response._httpStatus === 401) {
        // The backend tells us how many attempts are left in the
        // message — surface that to the user so they aren't blindsided.
        setSigninError(
          response.message || "Invalid email or password.",
        );
        return;
      }
      if (response._httpStatus !== 200 || !response.data) {
        setSigninError(response.message || "Login failed");
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
    setSigninError(null);
    setSigninStatus(null);
    setDemoOpen(false);
    try {
      const response = await startDemo({
        role,
        display_name: role === "admin" ? "Demo Admin" : "Demo Tester",
      });
      if (response._httpStatus !== 201 || !response.data) {
        setSigninError(response.message || "Could not start demo session");
        return;
      }
      const demoUser = response.data.user;
      signIn(demoUser);
      setSigninStatus(
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

  async function submitForgot(event: React.FormEvent) {
    event.preventDefault();
    setForgotError(null);
    setForgotStatus(null);
    setLoading(true);
    try {
      const response = await forgotPassword(forgotEmail);
      if (response._httpStatus >= 400) {
        setForgotError(response.message || "Forgot password request failed");
        return;
      }
      setForgotStatus(
        response.message ||
          "If the account exists, a reset link has been emailed.",
      );
    } finally {
      setLoading(false);
    }
  }

  // ---- Register handlers ----
  const updateRegField =
    (key: keyof RegisterFields) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setRegForm((current) => ({ ...current, [key]: event.target.value }));
    };

  async function submitRegisterForm(event: React.FormEvent) {
    event.preventDefault();
    setRegStatus(null);
    setRegError(null);

    let validated: RegisterFields;
    try {
      validated = (await registerStartSchema.validate(regForm, {
        abortEarly: false,
        stripUnknown: true,
      })) as RegisterFields;
      setRegErrors({});
    } catch (validationError) {
      setRegErrors(fieldErrors(validationError));
      return;
    }

    setLoading(true);
    try {
      const response = await registerStart(validated);
      if (response._httpStatus === 429) {
        setRegError(
          response.message || "Too many attempts. Please wait and retry.",
        );
        return;
      }
      // 409 — email already registered. Surface the message verbatim
      // (the backend already wrote it professionally). The action
      // buttons in the JSX below pick up `regError` containing
      // "already registered" to render Sign in / Forgot password
      // shortcuts.
      if (response._httpStatus === 409) {
        setRegError(
          response.message ||
            "An account is already registered with this email.",
        );
        return;
      }
      if (response._httpStatus !== 200) {
        setRegError(response.message || "Registration failed");
        return;
      }
      setRegStage("otp");
      setRegOtpExpiresInMinutes(response.data?.expiresInMinutes ?? null);
      setRegDevOtp(response.data?.devOtp || null);
      setRegStatus(
        response.message || "Verification code sent. Check your email.",
      );
      setRegResendCooldown(30);
    } finally {
      setLoading(false);
    }
  }

  async function submitRegisterOtp(event: React.FormEvent) {
    event.preventDefault();
    setRegStatus(null);
    setRegError(null);

    try {
      await registerVerifySchema.validate(
        { email: regForm.email, otp: regOtp },
        { abortEarly: false, stripUnknown: true },
      );
      setRegErrors({});
    } catch (validationError) {
      setRegErrors(fieldErrors(validationError));
      return;
    }

    setLoading(true);
    try {
      const response = await registerVerify({
        email: regForm.email.trim().toLowerCase(),
        otp: regOtp,
      });
      if (response._httpStatus !== 201) {
        setRegError(response.message || "Verification failed");
        return;
      }
      // Do NOT auto-sign-in. The user must authenticate explicitly
      // with their newly-set credentials — same security stance as
      // the invite-accept flow. We do remember the org name for the
      // success screen and pre-fill the email when they click
      // through to the sign-in tab.
      const org = response.data?.org;
      if (org) setRegCreatedOrgName(org.name);
      setRegStage("success");
      setRegStatus(
        response.message ||
          "Account verified. Your free organization is ready.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function resendRegisterOtp() {
    if (regResendCooldown > 0) return;
    setLoading(true);
    setRegError(null);
    setRegStatus(null);
    try {
      const response = await registerResend(
        regForm.email.trim().toLowerCase(),
      );
      if (response._httpStatus !== 200) {
        setRegError(response.message || "Resend failed");
        return;
      }
      setRegStatus(response.message || "A fresh code has been sent.");
      setRegOtpExpiresInMinutes(response.data?.expiresInMinutes ?? null);
      setRegDevOtp(response.data?.devOtp || null);
      setRegResendCooldown(30);
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
        <p className="auth-copy">{heroBlurb}</p>
      </div>

      <div className="auth-card">
        <div className="auth-tab-strip" role="tablist" aria-label="Auth flow">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`auth-tab ${tab === entry.id ? "active" : ""}`}
              onClick={() => {
                setTab(entry.id);
                if (entry.id === "register") setRegStage("form");
                setSigninError(null);
                setForgotError(null);
                setRegError(null);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === "signin" && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void performSignIn(signinEmail, signinPassword);
            }}
            className="auth-form"
          >
            <h2 className="panel-title">Welcome back</h2>

            <div className="form-field">
              <label className="field-label">Email</label>
              <input
                className="field-input"
                type="email"
                required
                value={signinEmail}
                onChange={(event) => setSigninEmail(event.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="form-field">
              <label className="field-label">Password</label>
              <input
                className="field-input"
                type="password"
                required
                value={signinPassword}
                onChange={(event) => setSigninPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>

            <button className="btn btn-primary" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>

            {signinError && <p className="status-error">{signinError}</p>}
            {signinStatus && <p className="status-note">{signinStatus}</p>}

            <button
              type="button"
              className="btn btn-accent"
              disabled={loading}
              onClick={() => setDemoOpen((value) => !value)}
            >
              Try demo mode
            </button>
          </form>
        )}

        {tab === "forgot" && (
          <form onSubmit={submitForgot} className="auth-form">
            <h2 className="panel-title">Reset your password</h2>
            <p className="panel-copy">
              Enter the email on your account. If it exists, you'll get a
              reset link by email — the link itself carries the secure token,
              you don't need to copy anything.
            </p>

            <div className="form-field">
              <label className="field-label">Email</label>
              <input
                className="field-input"
                type="email"
                required
                value={forgotEmail}
                onChange={(event) => setForgotEmail(event.target.value)}
                autoComplete="email"
              />
            </div>

            <button className="btn btn-primary" disabled={loading}>
              {loading ? "Sending..." : "Send reset link"}
            </button>

            {forgotError && <p className="status-error">{forgotError}</p>}
            {forgotStatus && <p className="status-note">{forgotStatus}</p>}
          </form>
        )}

        {tab === "register" && regStage === "form" && (
          <form onSubmit={submitRegisterForm} className="auth-form">
            <h2 className="panel-title">Create account</h2>

            <div className="form-field">
              <label className="field-label">Full name</label>
              <input
                className="field-input"
                type="text"
                required
                value={regForm.full_name}
                onChange={updateRegField("full_name")}
                autoComplete="name"
              />
              {regErrors.full_name && (
                <p className="status-error">{regErrors.full_name}</p>
              )}
            </div>

            <div className="form-field">
              <label className="field-label">Organization name</label>
              <input
                className="field-input"
                type="text"
                required
                value={regForm.org_name}
                onChange={updateRegField("org_name")}
                placeholder="Acme Inc."
              />
              {regErrors.org_name && (
                <p className="status-error">{regErrors.org_name}</p>
              )}
            </div>

            <div className="form-field">
              <label className="field-label">Email</label>
              <input
                className="field-input"
                type="email"
                required
                value={regForm.email}
                onChange={updateRegField("email")}
                autoComplete="email"
              />
              {regErrors.email && (
                <p className="status-error">{regErrors.email}</p>
              )}
            </div>

            <div className="form-field">
              <label className="field-label">Password</label>
              <input
                className="field-input"
                type="password"
                required
                value={regForm.password}
                onChange={updateRegField("password")}
                autoComplete="new-password"
              />
              <PasswordChecklist password={regForm.password} />
              {regErrors.password && (
                <p className="status-error">{regErrors.password}</p>
              )}
            </div>

            <div className="form-field">
              <label className="field-label">Confirm password</label>
              <input
                className="field-input"
                type="password"
                required
                value={regForm.confirmPassword}
                onChange={updateRegField("confirmPassword")}
                autoComplete="new-password"
              />
              {regForm.confirmPassword.length > 0 &&
                regForm.confirmPassword !== regForm.password && (
                  <p className="status-error">Passwords do not match</p>
                )}
              {regErrors.confirmPassword && (
                <p className="status-error">{regErrors.confirmPassword}</p>
              )}
            </div>

            <button
              className="btn btn-primary"
              disabled={
                loading ||
                !isPasswordStrong(regForm.password) ||
                regForm.password !== regForm.confirmPassword
              }
            >
              {loading ? "Sending code..." : "Send verification code"}
            </button>

            {regStatus && <p className="status-note">{regStatus}</p>}
            {regError && <p className="status-error">{regError}</p>}
            {/* If the backend signalled "already registered" we
                offer the two next-step shortcuts inline so the user
                doesn't have to hunt for the right tab. */}
            {regError && /already registered/i.test(regError) && (
              <div className="button-row" style={{ gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setSigninEmail(regForm.email);
                    setRegError(null);
                    setTab("signin");
                  }}
                >
                  Sign in instead
                </button>
                <button
                  type="button"
                  className="btn btn-muted"
                  onClick={() => {
                    setForgotEmail(regForm.email);
                    setRegError(null);
                    setTab("forgot");
                  }}
                >
                  Forgot password
                </button>
              </div>
            )}
          </form>
        )}

        {tab === "register" && regStage === "otp" && (
          <form onSubmit={submitRegisterOtp} className="auth-form">
            <h2 className="panel-title">Enter verification code</h2>
            <p className="panel-copy">
              We emailed a 6-digit code to <strong>{regForm.email}</strong>.
              {regOtpExpiresInMinutes != null && (
                <> It expires in {regOtpExpiresInMinutes} minutes.</>
              )}
            </p>

            {regDevOtp && (
              <p
                className="status-note"
                style={{ fontFamily: "monospace", letterSpacing: 2 }}
              >
                Dev mode code: {regDevOtp}
              </p>
            )}

            <div className="form-field">
              <label className="field-label">Verification code</label>
              <input
                className="field-input otp-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={regOtp}
                onChange={(event) =>
                  setRegOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                autoComplete="one-time-code"
                placeholder="123456"
              />
              {regErrors.otp && (
                <p className="status-error">{regErrors.otp}</p>
              )}
            </div>

            <button
              className="btn btn-primary"
              disabled={loading || regOtp.length !== 6}
            >
              {loading ? "Verifying..." : "Verify and create account"}
            </button>

            <button
              type="button"
              className="btn btn-muted"
              disabled={regResendCooldown > 0 || loading}
              onClick={resendRegisterOtp}
            >
              {regResendCooldown > 0
                ? `Resend in ${regResendCooldown}s`
                : "Resend code"}
            </button>

            {regStatus && <p className="status-note">{regStatus}</p>}
            {regError && <p className="status-error">{regError}</p>}

            <p className="panel-copy">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setRegStage("form");
                  setRegOtp("");
                }}
              >
                ← Edit registration details
              </button>
            </p>
          </form>
        )}

        {tab === "register" && regStage === "success" && (
          <section className="auth-form">
            <h2 className="panel-title">Account created 🎉</h2>
            <p className="panel-copy">
              Your free organization{" "}
              <strong>{regCreatedOrgName || regForm.org_name}</strong> is
              ready. Sign in with the credentials you just set to enter
              your dashboard.
            </p>
            <ul className="steps-list">
              <li>
                You're the <strong>owner</strong> of this organization.
              </li>
              <li>
                Add <strong>unlimited systems</strong> to monitor.
              </li>
              <li>
                Invite <strong>users</strong> with granular permission
                toggles.
              </li>
            </ul>
            <button
              className="btn btn-primary"
              onClick={() => {
                // Pre-fill the sign-in tab and switch to it. We
                // intentionally do NOT auto-authenticate the just-
                // registered user — they must enter their password
                // explicitly to prove control of the credentials.
                setSigninEmail(regForm.email.trim().toLowerCase());
                setSigninPassword("");
                setRegStage("form");
                setRegOtp("");
                setRegForm(INITIAL_REGISTER);
                setRegCreatedOrgName(null);
                setTab("signin");
              }}
            >
              Continue to sign in
            </button>
          </section>
        )}
      </div>

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
    </section>
  );
}
