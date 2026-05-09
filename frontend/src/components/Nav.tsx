import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import logoDark from "../../assets/No_Name_Dark.png";
import logoLight from "../../assets/No_Name_Light.png";

export default function Nav() {
  const navigate = useNavigate();
  const { user, signOut, isDemo } = useAuth();
  const { theme, toggleTheme } = useTheme();

  if (!user) {
    return null;
  }

  const logoSrc = theme === "dark" ? logoDark : logoLight;

  function onLogout() {
    signOut();
    navigate("/login", { replace: true });
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

      <div className="session-inline">
        {isDemo && (
          <span
            className="dev-quick-tag"
            style={{
              background: "#7d4eff22",
              color: "#7d4eff",
              border: "1px solid #7d4eff66",
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              marginRight: 4,
            }}
          >
            DEMO
          </span>
        )}
        <button className="btn btn-muted" onClick={toggleTheme}>
          {theme === "dark" ? "Light" : "Dark"} Mode
        </button>
        {!isDemo && (
          <Link to="/profile" className="btn btn-surface">
            {user.full_name}
          </Link>
        )}
        {isDemo && <p className="session-user">{user.full_name}</p>}
        <button className="btn btn-logout" onClick={onLogout}>
          {isDemo ? "Exit demo" : "Logout"}
        </button>
      </div>
    </nav>
  );
}
