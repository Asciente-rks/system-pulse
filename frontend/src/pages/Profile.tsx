import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getMe,
  updateMyEmailStart,
  updateMyEmailVerify,
  updateMyName,
  updateOrg,
} from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { fullNameYup, emailYup, otpYup, orgNameYup } from "../utils/validation";
import * as yup from "yup";

type EmailStage = "idle" | "verify";

export default function Profile() {
  const navigate = useNavigate();
  const { user, signIn, isOwner, isDemo } = useAuth();

  // ---- Name change ----
  const [name, setName] = useState(user?.full_name || "");
  const [namePassword, setNamePassword] = useState("");
  const [nameStatus, setNameStatus] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameLoading, setNameLoading] = useState(false);

  // ---- Email change (two-step OTP) ----
  const [emailStage, setEmailStage] = useState<EmailStage>("idle");
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailDevOtp, setEmailDevOtp] = useState<string | null>(null);
  const [emailExpiresIn, setEmailExpiresIn] = useState<number | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);

  // ---- Org rename (owner only) ----
  const [orgName, setOrgName] = useState(user?.orgName || "");
  const [orgStatus, setOrgStatus] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    setName(user.full_name);
    setOrgName(user.orgName || "");
  }, [user, navigate]);

  const canEditOwnProfile = useMemo(() => {
    if (!user) return false;
    // Demo accounts are read-mostly across the platform; profile
    // edits would persist on the demo user record (which auto-
    // expires) but the guard rejects on the backend so we mirror
    // the rejection here for clearer UX.
    return !isDemo;
  }, [user, isDemo]);

  async function refreshSession() {
    const response = await getMe();
    if (response._httpStatus === 200 && response.data) {
      signIn(response.data);
    }
  }

  async function submitName(event: React.FormEvent) {
    event.preventDefault();
    setNameStatus(null);
    setNameError(null);

    try {
      await fullNameYup.validate(name);
      await yup.string().required().validate(namePassword);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Invalid input");
      return;
    }

    setNameLoading(true);
    try {
      const response = await updateMyName({
        full_name: name,
        password: namePassword,
      });
      if (response._httpStatus >= 400) {
        setNameError(response.message || "Could not update name");
        return;
      }
      setNameStatus("Name updated.");
      setNamePassword("");
      await refreshSession();
    } finally {
      setNameLoading(false);
    }
  }

  async function submitEmailStart(event: React.FormEvent) {
    event.preventDefault();
    setEmailStatus(null);
    setEmailError(null);

    try {
      await emailYup.validate(newEmail);
      await yup.string().required().validate(emailPassword);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Invalid input");
      return;
    }

    setEmailLoading(true);
    try {
      const response = await updateMyEmailStart({
        new_email: newEmail.trim().toLowerCase(),
        password: emailPassword,
      });
      if (response._httpStatus >= 400) {
        setEmailError(response.message || "Could not start email change");
        return;
      }
      setEmailStage("verify");
      setEmailExpiresIn(response.data?.expiresInMinutes ?? null);
      setEmailDevOtp(response.data?.devOtp || null);
      setEmailStatus(
        response.message || "Verification code sent to the new email.",
      );
    } finally {
      setEmailLoading(false);
    }
  }

  async function submitEmailVerify(event: React.FormEvent) {
    event.preventDefault();
    setEmailStatus(null);
    setEmailError(null);

    try {
      await otpYup.validate(emailOtp);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Invalid OTP");
      return;
    }

    setEmailLoading(true);
    try {
      const response = await updateMyEmailVerify({ otp: emailOtp });
      if (response._httpStatus >= 400) {
        setEmailError(response.message || "Verification failed");
        return;
      }
      setEmailStatus("Email updated.");
      setEmailStage("idle");
      setNewEmail("");
      setEmailOtp("");
      setEmailPassword("");
      setEmailDevOtp(null);
      await refreshSession();
    } finally {
      setEmailLoading(false);
    }
  }

  async function submitOrgRename(event: React.FormEvent) {
    event.preventDefault();
    setOrgStatus(null);
    setOrgError(null);

    if (!user?.orgId) {
      setOrgError("No organization to rename");
      return;
    }

    try {
      await orgNameYup.validate(orgName);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Invalid org name");
      return;
    }

    setOrgLoading(true);
    try {
      const response = await updateOrg({ orgId: user.orgId, name: orgName });
      if (response._httpStatus >= 400) {
        setOrgError(response.message || "Could not rename organization");
        return;
      }
      setOrgStatus("Organization renamed.");
      await refreshSession();
    } finally {
      setOrgLoading(false);
    }
  }

  if (!user) return null;

  // Where "Back" should point. Tester-tier roles land on the
  // tester dashboard, everyone else on /admin.
  const backTarget =
    user.role === "tester" || user.role === "user" ? "/tester" : "/admin";

  return (
    <div className="stack-lg">
      <div className="profile-header-row">
        <button
          type="button"
          className="btn btn-muted"
          onClick={() => {
            // Use history if there's something behind us, else
            // route to the role-appropriate landing page.
            if (window.history.length > 1) navigate(-1);
            else navigate(backTarget, { replace: true });
          }}
        >
          ← Back
        </button>
      </div>

      <section className="panel panel-hero">
        <h2 className="panel-title">My profile</h2>
        <p className="panel-copy">
          {user.full_name} · {user.email} ·{" "}
          <span className={`role-pill role-${user.role}`}>{user.role}</span>
        </p>
        {isDemo && (
          <p className="status-error">
            Demo accounts can't edit profile fields. Sign up for a free account
            to change your name, email, or org.
          </p>
        )}
      </section>

      <section className="panel">
        <h3 className="panel-subtitle">Display name</h3>
        <p className="panel-copy compact-copy">
          Confirm with your current password to change.
        </p>
        <form
          onSubmit={submitName}
          className="form-grid form-grid-2col"
        >
          <div className="form-field">
            <label className="field-label">Full name</label>
            <input
              className="field-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              disabled={!canEditOwnProfile}
            />
          </div>
          <div className="form-field">
            <label className="field-label">Current password</label>
            <input
              className="field-input"
              type="password"
              value={namePassword}
              onChange={(event) => setNamePassword(event.target.value)}
              required
              disabled={!canEditOwnProfile}
              autoComplete="current-password"
            />
          </div>
          <div className="form-field form-action-field">
            <label className="field-label">&nbsp;</label>
            <button
              className="btn btn-primary"
              disabled={!canEditOwnProfile || nameLoading}
            >
              {nameLoading ? "Saving..." : "Update name"}
            </button>
          </div>
        </form>
        {nameStatus && <p className="status-note">{nameStatus}</p>}
        {nameError && <p className="status-error">{nameError}</p>}
      </section>

      <section className="panel">
        <h3 className="panel-subtitle">Email</h3>
        <p className="panel-copy compact-copy">
          Changing your email requires your current password and a 6-digit
          code we'll send to the new address.
        </p>

        {emailStage === "idle" && (
          <form
            onSubmit={submitEmailStart}
            className="form-grid form-grid-2col"
          >
            <div className="form-field">
              <label className="field-label">New email</label>
              <input
                className="field-input"
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                required
                disabled={!canEditOwnProfile}
                autoComplete="email"
              />
            </div>
            <div className="form-field">
              <label className="field-label">Current password</label>
              <input
                className="field-input"
                type="password"
                value={emailPassword}
                onChange={(event) => setEmailPassword(event.target.value)}
                required
                disabled={!canEditOwnProfile}
                autoComplete="current-password"
              />
            </div>
            <div className="form-field form-action-field">
              <label className="field-label">&nbsp;</label>
              <button
                className="btn btn-primary"
                disabled={!canEditOwnProfile || emailLoading}
              >
                {emailLoading ? "Sending code..." : "Send verification code"}
              </button>
            </div>
          </form>
        )}

        {emailStage === "verify" && (
          <form onSubmit={submitEmailVerify} className="form-grid form-grid-2col">
            <p className="panel-copy compact-copy">
              We emailed a 6-digit code to <strong>{newEmail}</strong>.
              {emailExpiresIn != null && (
                <> It expires in {emailExpiresIn} minutes.</>
              )}
            </p>
            {emailDevOtp && (
              <p
                className="status-note"
                style={{ fontFamily: "monospace", letterSpacing: 2 }}
              >
                Dev mode code: {emailDevOtp}
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
                value={emailOtp}
                onChange={(event) =>
                  setEmailOtp(
                    event.target.value.replace(/\D/g, "").slice(0, 6),
                  )
                }
                autoComplete="one-time-code"
                placeholder="123456"
              />
            </div>
            <div className="form-field form-action-field">
              <label className="field-label">&nbsp;</label>
              <button
                className="btn btn-primary"
                disabled={emailLoading || emailOtp.length !== 6}
              >
                {emailLoading ? "Verifying..." : "Verify and update"}
              </button>
            </div>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setEmailStage("idle");
                setEmailOtp("");
              }}
            >
              ← Cancel and start over
            </button>
          </form>
        )}

        {emailStatus && <p className="status-note">{emailStatus}</p>}
        {emailError && <p className="status-error">{emailError}</p>}
      </section>

      {isOwner && user.orgId && (
        <section className="panel">
          <h3 className="panel-subtitle">Organization</h3>
          <p className="panel-copy compact-copy">
            Only the org owner can rename the organization.
          </p>
          <form onSubmit={submitOrgRename} className="form-grid form-grid-2col">
            <div className="form-field">
              <label className="field-label">Organization name</label>
              <input
                className="field-input"
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
                required
                disabled={isDemo}
              />
            </div>
            <div className="form-field form-action-field">
              <label className="field-label">&nbsp;</label>
              <button
                className="btn btn-primary"
                disabled={isDemo || orgLoading}
              >
                {orgLoading ? "Saving..." : "Rename organization"}
              </button>
            </div>
          </form>
          {orgStatus && <p className="status-note">{orgStatus}</p>}
          {orgError && <p className="status-error">{orgError}</p>}
        </section>
      )}
    </div>
  );
}
