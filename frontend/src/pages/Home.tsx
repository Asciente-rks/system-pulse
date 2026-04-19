import React from "react";
import { getApiBaseUrl } from "../services/api";

export default function Home() {
  const apiBase = getApiBaseUrl();

  const endpoints = [
    "POST /users/invite",
    "POST /users/invite/accept",
    "POST /users/{id}/systems",
    "POST /systems",
    "POST /systems/{id}/trigger",
    "GET /systems/{id}/logs",
  ];

  return (
    <div className="stack-lg">
      <section className="panel">
        <h2 className="panel-title">Deployment Overview</h2>
        <p className="panel-copy">
          Frontend targets Vercel. Backend targets AWS API Gateway + Lambda.
          This panel is a direct operator UI for your system pulse endpoints.
        </p>
        <p className="panel-copy">
          Active API base: <strong>{apiBase}</strong>
        </p>
      </section>

      <section className="panel">
        <h3 className="panel-subtitle">Available Endpoints</h3>
        <div className="pill-grid">
          {endpoints.map((endpoint) => (
            <span key={endpoint} className="pill">
              {endpoint}
            </span>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3 className="panel-subtitle">Operational Flow</h3>
        <ol className="steps-list">
          <li>Invite users as admin or superadmin.</li>
          <li>User accepts invite and sets password.</li>
          <li>Add system URL then trigger health check.</li>
          <li>Queue worker performs immediate check.</li>
          <li>If still down, delayed recheck runs after 90 seconds.</li>
          <li>Inspect logs from the Systems page.</li>
        </ol>
      </section>
    </div>
  );
}
