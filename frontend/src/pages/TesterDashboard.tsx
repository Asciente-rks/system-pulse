import React, { useEffect, useState } from "react";
import {
  getSystemLogs,
  listSystems,
  triggerHealth,
  type SystemSummary,
} from "../services/api";

type TesterTab = "systems" | "logs";

export default function TesterDashboard() {
  const [activeTab, setActiveTab] = useState<TesterTab>("systems");
  const [systems, setSystems] = useState<SystemSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logsSystemId, setLogsSystemId] = useState("");
  const [logsResult, setLogsResult] = useState<Record<string, unknown> | null>(
    null,
  );
  const [checkingUntilBySystem, setCheckingUntilBySystem] = useState<
    Record<string, number>
  >({});
  const [timeNow, setTimeNow] = useState(() => Date.now());

  async function loadSystems() {
    setBusy("load");
    setErrorMessage(null);
    try {
      const response = await listSystems(150);
      setSystems(response.data?.systems || []);

      if (response._httpStatus >= 400) {
        setErrorMessage(String(response.message || "Failed to load systems"));
      }
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadSystems();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimeNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  async function handleTrigger(systemId: string) {
    setBusy(`trigger-${systemId}`);
    setErrorMessage(null);
    try {
      const response = await triggerHealth(systemId);

      if (response._httpStatus >= 400) {
        setErrorMessage(String(response.message || "Trigger failed"));
        return;
      }

      const delaySecondsRaw = (
        response.data as { delayedRecheckSeconds?: unknown } | undefined
      )?.delayedRecheckSeconds;
      const delaySeconds = Number(delaySecondsRaw);

      if (Number.isFinite(delaySeconds) && delaySeconds > 0) {
        setCheckingUntilBySystem((current) => ({
          ...current,
          [systemId]: Date.now() + delaySeconds * 1000,
        }));
        setStatusMessage(
          `Health check queued for ${systemId}. Render wake-up recheck in ${delaySeconds}s.`,
        );
      } else {
        setCheckingUntilBySystem((current) => {
          const next = { ...current };
          delete next[systemId];
          return next;
        });
        setStatusMessage(
          `Health check queued for ${systemId}. Standard single-pass workflow.`,
        );
      }

      await loadSystems();
    } finally {
      setBusy(null);
    }
  }

  function isChecking(systemId: string) {
    const until = checkingUntilBySystem[systemId] || 0;
    return until > timeNow;
  }

  async function handleLogs(systemId: string) {
    setBusy(`logs-${systemId}`);
    setErrorMessage(null);

    try {
      const response = await getSystemLogs(systemId, 20);

      if (response._httpStatus >= 400) {
        setErrorMessage(String(response.message || "Log fetch failed"));
        return;
      }

      setLogsSystemId(systemId);
      setLogsResult(response as unknown as Record<string, unknown>);
      setActiveTab("logs");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack-lg">
      <section className="panel panel-hero">
        <h2 className="panel-title">Tester Dashboard</h2>
        <p className="panel-copy">
          Trigger health checks for your assigned systems. Render systems use an
          automatic delayed recheck; standard systems run a single-pass check.
        </p>
        <div className="dashboard-tabs">
          <button
            className={`tab-pill ${activeTab === "systems" ? "active" : ""}`}
            onClick={() => setActiveTab("systems")}
          >
            Systems
          </button>
          <button
            className={`tab-pill ${activeTab === "logs" ? "active" : ""}`}
            onClick={() => setActiveTab("logs")}
          >
            Logs
          </button>
        </div>
        {statusMessage && <p className="status-note">{statusMessage}</p>}
        {errorMessage && <p className="status-error">{errorMessage}</p>}
      </section>

      {activeTab === "systems" && (
        <section className="panel">
          <h3 className="panel-subtitle">Assigned Systems</h3>
          <div className="button-row">
            <button
              className="btn btn-success"
              onClick={loadSystems}
              disabled={busy === "load"}
            >
              {busy === "load" ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="grid-cards">
            {systems.map((system) => (
              <article key={system.id} className="system-card">
                <div>
                  <p className="system-title">{system.name}</p>
                  <p className="panel-copy system-url">{system.url}</p>
                  <p className="panel-copy">
                    Status: {system.status || "UNKNOWN"}
                  </p>
                  <p className="panel-copy">
                    Last check: {system.lastChecked || "No checks yet"}
                  </p>
                </div>

                <div className="button-row system-actions system-actions-2">
                  <button
                    className="btn btn-success system-action-btn"
                    onClick={() => handleTrigger(system.id)}
                    disabled={
                      busy === `trigger-${system.id}` || isChecking(system.id)
                    }
                  >
                    {busy === `trigger-${system.id}`
                      ? "Queueing..."
                      : isChecking(system.id)
                        ? "Checking..."
                        : "Trigger"}
                  </button>
                  <button
                    className="btn btn-warning system-action-btn"
                    onClick={() => handleLogs(system.id)}
                    disabled={busy === `logs-${system.id}`}
                  >
                    {busy === `logs-${system.id}` ? "Loading..." : "View Logs"}
                  </button>
                </div>
              </article>
            ))}
          </div>

          {systems.length === 0 && (
            <p className="panel-copy">No systems assigned yet.</p>
          )}
        </section>
      )}

      {activeTab === "logs" && (
        <section className="panel">
          <h3 className="panel-subtitle">Logs</h3>
          <p className="panel-copy">
            {logsResult
              ? `System: ${logsSystemId}`
              : "Pick a system and open logs."}
          </p>
          {logsResult && (
            <pre className="result-box">
              {JSON.stringify(logsResult, null, 2)}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
