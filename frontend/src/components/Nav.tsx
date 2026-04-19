import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";

export default function Nav() {
  const [role, setRole] = useState<string>(
    localStorage.getItem("role") || "tester",
  );
  const [userId, setUserId] = useState<string | null>(
    localStorage.getItem("userId"),
  );

  useEffect(() => {
    localStorage.setItem("role", role);
  }, [role]);

  useEffect(() => {
    if (userId) {
      localStorage.setItem("userId", userId);
      return;
    }

    localStorage.removeItem("userId");
  }, [userId]);

  const links = [
    { to: "/", label: "Overview" },
    { to: "/invite", label: "Invite" },
    { to: "/systems", label: "Systems" },
    { to: "/assign", label: "Access" },
    { to: "/accept-invite", label: "Accept Invite" },
  ];

  return (
    <nav className="nav-grid">
      <div className="brand-block">
        <p className="brand-title">System Pulse</p>
        <p className="brand-subtitle">AWS health control panel</p>
      </div>

      <div className="nav-links">
        {links.map((link) => (
          <Link key={link.to} className="nav-link" to={link.to}>
            {link.label}
          </Link>
        ))}
      </div>

      <div className="session-controls">
        <label className="field-label" htmlFor="role-select">
          Role
        </label>
        <select
          id="role-select"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="field-input"
        >
          <option value="superadmin">superadmin</option>
          <option value="admin">admin</option>
          <option value="tester">tester</option>
        </select>

        <label className="field-label" htmlFor="user-id-input">
          User ID
        </label>
        <input
          id="user-id-input"
          placeholder="for tester-restricted actions"
          value={userId || ""}
          onChange={(e) => setUserId(e.target.value)}
          className="field-input"
        />
      </div>
    </nav>
  );
}
