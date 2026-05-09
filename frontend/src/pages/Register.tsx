import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  registerStart,
  registerVerify,
  registerResend,
} from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import logoDark from "../../assets/With_Name_Dark.png";
import logoLight from "../../assets/With_Name_Light.png";
import {
  fieldErrors,
  registerStartSchema,
  registerVerifySchema,
} from "../utils/validation";
import PasswordChecklist, {
  isPasswordStrong,
} from "../components/PasswordChecklist";

type Stage = "form" | "otp" | "success";

interface FormFields {
  email: string;
  password: string;
  confirmPassword: string;
  full_name: string;
  org_name: string;
}

const INITIAL_FORM: FormFields = {
  email: "",
  password: "",
  confirmPassword: "",
  full_name: "",
  org_name: "",
};

export default function Register() {
  const navigate = useNavigate();
  const { user, signIn } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [stage, setStage] = useState<Stage>("form");
  const [form, setForm] = useState<FormFields>(INITIAL_FORM);
  const [otp, setOtp] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [otpExpiresInMinutes, setOtpExpiresInMinutes] = useState<number | null>(
    null,
  );
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [createdOrgName, setCreatedOrgName] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (!user) return;
    if (user.role === "user" || user.role === "tester") {
      navigate("/tester", { replace: true });
    } else {
      navigate("/admin", { replace: true });
    }
  }, [navigate, user]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = window.setInterval(
      () => setResendCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [resendCooldown]);

  const updateField = (key: keyof FormFields) => (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    let validated: FormFields;
    try {
      validated = (await registerStartSchema.validate(form, {
        abortEarly: false,
        stripUnknown: true,
      })) as FormFields;
      setErrors({});
    } catch (validationError) {
      setErrors(fieldErrors(validationError));
      return;
    }

    setLoading(true);
    try {
      const response = await registerStart(validated);

      if (response._httpStatus === 429) {
        setErrorMessage(
          response.message || "Too many attempts. Please wait and retry.",
        );
        return;
      }

      if (response._httpStatus !== 200) {
        setErrorMessage(response.message || "Registration failed");
        return;
      }

      setStage("otp");
      setOtpExpiresInMinutes(response.data?.expiresInMinutes ?? null);
      setDevOtp(response.data?.devOtp || null);
      setStatusMessage(
        response.message ||
          "Verification code sent. Check your email.",
      );
      setResendCooldown(30);
    } finally {
      setLoading(false);
    }
  }

  async function submitOtp(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await registerVerifySchema.validate(
        { email: form.email, otp },
        { abortEarly: false, stripUnknown: true },
      );
      setErrors({});
    } catch (validationError) {
      setErrors(fieldErrors(validationError));
      return;
    }

    setLoading(true);
    try {
      const response = await registerVerify({
        email: form.email.trim().toLowerCase(),
        otp,
      });

      if (response._httpStatus !== 201) {
        setErrorMessage(response.message || "Verification failed");
        return;
      }

      const created = response.data?.user;
      const org = response.data?.org;
      if (created) {
        signIn(created);
      }
      if (org) {
        setCreatedOrgName(org.name);
      }
      setStage("success");
      setStatusMessage(
        response.message ||
          "Account verified. Your free organization is ready.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (resendCooldown > 0) return;
    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const response = await registerResend(form.email.trim().toLowerCase());
      if (response._httpStatus !== 200) {
        setErrorMessage(response.message || "Resend failed");
        return;
      }
      setStatusMessage(response.message || "A fresh code has been sent.");
      setOtpExpiresInMinutes(response.data?.expiresInMinutes ?? null);
      setDevOtp(response.data?.devOtp || null);
      setResendCooldown(30);
    } finally {
      setLoading(false);
    }
  }

  function continueToDashboard() {
    navigate("/admin", { replace: true });
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
        <p className="auth-kicker">Create your free workspace</p>
        <h1 className="auth-title">Sign up for System Pulse</h1>
        <p className="auth-copy">
          One sign-up gives you an admin account, a free organization, and
          unlimited systems to monitor. Verify with a 6-digit code we email
          you.
        </p>
      </div>

      {stage === "form" && (
        <form className="auth-card" onSubmit={submitForm}>
          <h2 className="panel-title">Create account</h2>

          <div className="form-field">
            <label className="field-label">Full name</label>
            <input
              className="field-input"
              type="text"
              required
              value={form.full_name}
              onChange={updateField("full_name")}
              autoComplete="name"
            />
            {errors.full_name && (
              <p className="status-error">{errors.full_name}</p>
            )}
          </div>

          <div className="form-field">
            <label className="field-label">Organization name</label>
            <input
              className="field-input"
              type="text"
              required
              value={form.org_name}
              onChange={updateField("org_name")}
              placeholder="Acme Inc."
            />
            {errors.org_name && (
              <p className="status-error">{errors.org_name}</p>
            )}
          </div>

          <div className="form-field">
            <label className="field-label">Email</label>
            <input
              className="field-input"
              type="email"
              required
              value={form.email}
              onChange={updateField("email")}
              autoComplete="email"
            />
            {errors.email && <p className="status-error">{errors.email}</p>}
          </div>

          <div className="form-field">
            <label className="field-label">Password</label>
            <input
              className="field-input"
              type="password"
              required
              value={form.password}
              onChange={updateField("password")}
              autoComplete="new-password"
            />
            <PasswordChecklist password={form.password} />
            {errors.password && (
              <p className="status-error">{errors.password}</p>
            )}
          </div>

          <div className="form-field">
            <label className="field-label">Confirm password</label>
            <input
              className="field-input"
              type="password"
              required
              value={form.confirmPassword}
              onChange={updateField("confirmPassword")}
              autoComplete="new-password"
            />
            {form.confirmPassword.length > 0 &&
              form.confirmPassword !== form.password && (
                <p className="status-error">Passwords do not match</p>
              )}
            {errors.confirmPassword && (
              <p className="status-error">{errors.confirmPassword}</p>
            )}
          </div>

          <button
            className="btn btn-primary"
            disabled={
              loading ||
              !isPasswordStrong(form.password) ||
              form.password !== form.confirmPassword
            }
          >
            {loading ? "Sending code..." : "Send verification code"}
          </button>

          {statusMessage && <p className="status-note">{statusMessage}</p>}
          {errorMessage && <p className="status-error">{errorMessage}</p>}

          <p className="panel-copy">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      )}

      {stage === "otp" && (
        <form className="auth-card" onSubmit={submitOtp}>
          <h2 className="panel-title">Enter verification code</h2>
          <p className="panel-copy">
            We emailed a 6-digit code to <strong>{form.email}</strong>.
            {otpExpiresInMinutes != null && (
              <> It expires in {otpExpiresInMinutes} minutes.</>
            )}
          </p>

          {devOtp && (
            <p
              className="status-note"
              style={{ fontFamily: "monospace", letterSpacing: 2 }}
            >
              Dev mode code: {devOtp}
            </p>
          )}

          <div className="form-field">
            <label className="field-label">Verification code</label>
            <input
              className="field-input"
              type="text"
              inputMode="numeric"
              // [0-9]{6} avoids JSX-attribute escaping ambiguity that
              // `\\d{6}` introduces — JSX double-quoted attributes are
              // not escape-processed, so `\\d` would land in the HTML
              // attribute as a literal backslash-d and never match.
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={otp}
              onChange={(event) =>
                setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              autoComplete="one-time-code"
              placeholder="123456"
              style={{ letterSpacing: 6, textAlign: "center" }}
            />
            {errors.otp && <p className="status-error">{errors.otp}</p>}
          </div>

          <button
            className="btn btn-primary"
            disabled={loading || otp.length !== 6}
          >
            {loading ? "Verifying..." : "Verify and create account"}
          </button>

          <button
            type="button"
            className="btn btn-muted"
            disabled={resendCooldown > 0 || loading}
            onClick={resend}
          >
            {resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : "Resend code"}
          </button>

          {statusMessage && <p className="status-note">{statusMessage}</p>}
          {errorMessage && <p className="status-error">{errorMessage}</p>}

          <p className="panel-copy">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setStage("form");
                setOtp("");
              }}
            >
              ← Edit registration details
            </button>
          </p>
        </form>
      )}

      {stage === "success" && (
        <section className="auth-card">
          <h2 className="panel-title">You're in! 🎉</h2>
          <p className="panel-copy">
            Welcome to System Pulse. Your account is verified and your free
            organization{" "}
            <strong>{createdOrgName || form.org_name}</strong> is ready to go.
          </p>
          <ul className="steps-list">
            <li>
              You're the <strong>admin</strong> of this organization.
            </li>
            <li>
              Add <strong>unlimited systems</strong> to monitor.
            </li>
            <li>
              Invite <strong>users</strong> who can run health checks for
              assigned systems.
            </li>
          </ul>
          <button
            className="btn btn-primary"
            onClick={continueToDashboard}
          >
            Go to my dashboard
          </button>
        </section>
      )}
    </section>
  );
}
