import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import logoDark from "../../assets/No_Name_Dark.png";
import logoLight from "../../assets/No_Name_Light.png";

export default function Nav() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
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
          <p className="brand-subtitle">Automation and Health Monitoring</p>
        </div>
      </div>

      <div className="session-inline">
        <button className="btn btn-muted" onClick={toggleTheme}>
          {theme === "dark" ? "Light" : "Dark"} Mode
        </button>
        <p className="session-user">{user.full_name}</p>
        <button className="btn btn-logout" onClick={onLogout}>
          Logout
        </button>
      </div>
    </nav>
  );
}
