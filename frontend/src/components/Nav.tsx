import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import logoDark from "../../assets/No_Name_Dark.png";
import logoLight from "../../assets/No_Name_Light.png";

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

export default function Nav() {
  const navigate = useNavigate();
  const { user, signOut, isDemo } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + on Escape — standard popover hygiene.
  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (!user) return null;

  const logoSrc = theme === "dark" ? logoDark : logoLight;

  function onLogout() {
    setOpen(false);
    signOut();
    navigate("/login", { replace: true });
  }

  function onProfile() {
    setOpen(false);
    navigate("/profile");
  }

  return (
    <nav className="nav-grid">
      <div className="brand-block">
        <img src={logoSrc} alt="System Pulse" className="brand-logo" />
        <div>
          <p className="brand-title">SystemPulse</p>
          <p className="brand-subtitle">
            {user.orgName
              ? `Organization · ${user.orgName}`
              : "Automation and Health Monitoring"}
          </p>
        </div>
      </div>

      <div className="session-inline" ref={popoverRef}>
        {isDemo && <span className="demo-chip">DEMO</span>}

        <button className="btn btn-muted" onClick={toggleTheme}>
          {theme === "dark" ? "Light" : "Dark"} Mode
        </button>

        <button
          type="button"
          className="user-avatar-btn"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Open user menu"
          title={user.full_name}
        >
          <span className="user-avatar">{initials(user.full_name)}</span>
        </button>

        {open && (
          <div className="user-popover" role="menu">
            <div className="user-popover-head">
              <span className="user-avatar user-avatar-large">
                {initials(user.full_name)}
              </span>
              <div className="user-popover-meta">
                <strong className="user-popover-name">
                  {user.full_name}
                </strong>
                <span className={`role-pill role-${user.role}`}>
                  {user.role}
                </span>
                {user.email && (
                  <span className="user-popover-email">{user.email}</span>
                )}
              </div>
            </div>

            <div className="user-popover-actions">
              {!isDemo && (
                <button
                  type="button"
                  role="menuitem"
                  className="btn btn-surface user-popover-action"
                  onClick={onProfile}
                >
                  My profile
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="btn btn-logout user-popover-action"
                onClick={onLogout}
              >
                {isDemo ? "Exit demo" : "Logout"}
              </button>
            </div>

            {isDemo && (
              <button
                type="button"
                className="user-popover-cta"
                onClick={() => {
                  // Clear the demo session BEFORE routing so Login's
                  // "if authenticated, redirect to dashboard" effect
                  // doesn't bounce the user straight back to /tester.
                  setOpen(false);
                  signOut();
                  navigate("/register", { replace: true });
                }}
              >
                Sign up for a free account →
              </button>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
