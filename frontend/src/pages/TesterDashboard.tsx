import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  getSystemLogs,
  listSystems,
  triggerHealth,
  type SystemSummary,
} from "../services/api";
import { useAuth } from "../hooks/useAuth";
import {
  getSystemHealthStatus,
  normalizeHealthStatus,
  statusPillClassName,
} from "../utils/health-status";

type TesterTab = "systems" | "logs";

const POLL_INTERVAL_MS = 10_000;
const FAST_POLL_INTERVAL_MS = 4_000;

export default function TesterDashboard() {
  const { user, isDemo, can } = useAuth();
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

  const loadingRef = useRef(false);

  async function loadSystems(silent = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) {
      setBusy("load");
      setErrorMessage(null);
    }
    try {
      const response = await listSystems(150);
      setSystems(response.data?.systems || []);
      if (!silent && response._httpStatus >= 400) {
        setErrorMessage(String(response.message || "Failed to load systems"));
      }
    } finally {
      loadingRef.current = false;
      if (!silent) setBusy(null);
    }
  }

  useEffect(() => {
    void loadSystems();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTimeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const hasPendingChecks = useMemo(
    () =>
      Object.values(checkingUntilBySystem).some((until) => until > timeNow),
    [checkingUntilBySystem, timeNow],
  );

  // Real-time refresh. Faster cadence while there are pending checks.
  useEffect(() => {
    const interval = hasPendingChecks
      ? FAST_POLL_INTERVAL_MS
      : POLL_INTERVAL_MS;
    const id = window.setInterval(() => {
      void loadSystems(true);
    }, interval);
    return () => window.clearInterval(id);
  }, [hasPendingChecks]);

  // If a logs view is open, refresh logs alongside the systems poll
  // so the user sees new entries appear without clicking again.
  useEffect(() => {
    if (!logsSystemId) return;
    const refresh = async () => {
      try {
        const response = await getSystemLogs(logsSystemId, 20);
        if (response._httpStatus >= 400) return;
        setLogsResult(response as unknown as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    };
    const interval = hasPendingChecks
      ? FAST_POLL_INTERVAL_MS
      : POLL_INTERVAL_MS;
    const id = window.setInterval(refresh, interval);
    return () => window.clearInterval(id);
  }, [logsSystemId, hasPendingChecks]);

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

      const totalDelay =
        Number.isFinite(delaySeconds) && delaySeconds > 0
          ? delaySeconds + 5
          : 8;

      setCheckingUntilBySystem((current) => ({
        ...current,
        [systemId]: Date.now() + totalDelay * 1000,
      }));

      setStatusMessage(
        Number.isFinite(delaySeconds) && delaySeconds > 0
          ? `Health check queued. Render wake-up recheck in ${delaySeconds}s.`
          : `Health check queued. Live status will refresh shortly.`,
      );

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

      const latestLog = (
        response.data as
          | {
              logs?: Array<{
                status?: unknown;
                checkedAt?: string;
                responseCode?: number;
                responseTimeMs?: number;
              }>;
            }
          | undefined
      )?.logs?.[0];

      if (latestLog) {
        setSystems((current) =>
          current.map((system) =>
            system.id === systemId
              ? {
                  ...system,
                  status: normalizeHealthStatus(
                    latestLog.status,
                    latestLog.responseCode,
                  ),
                  lastChecked: latestLog.checkedAt || system.lastChecked,
                  lastResponseCode:
                    latestLog.responseCode ?? system.lastResponseCode,
                  responseTimeMs:
                    latestLog.responseTimeMs ?? system.responseTimeMs,
                }
              : system,
          ),
        );
      }

      setActiveTab("logs");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack-lg">
      {isDemo && (
        <section className="panel demo-banner">
          <p className="panel-title" style={{ marginBottom: 6 }}>
            🧪 Demo mode active
          </p>
          <p className="panel-copy compact-copy">
            You're exploring real systems. Triggering checks and viewing logs
            works exactly like a real tester.
          </p>
        </section>
      )}

      <section className="panel panel-hero">
        <h2 className="panel-title">
          {user?.orgName
            ? `${user.orgName} — Tester Dashboard`
            : "Tester Dashboard"}
        </h2>
        <p className="panel-copy">
          Trigger health checks for your assigned systems. Status auto-refreshes;
          Render systems use an automatic delayed recheck.
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
              onClick={() => loadSystems()}
              disabled={busy === "load"}
            >
              {busy === "load" ? "Refreshing..." : "Refresh"}
            </button>
            <span
              className="panel-copy compact-copy"
              style={{ alignSelf: "center", opacity: 0.7 }}
            >
              Live updates every {hasPendingChecks ? "4" : "10"}s
            </span>
          </div>

          <div className="grid-cards">
            {systems.map((system) => {
              const status = getSystemHealthStatus(system);

              return (
                <article key={system.id} className="system-card">
                  <div>
                    <span className={statusPillClassName(status)}>
                      {status}
                    </span>
                    <p className="system-title">{system.name}</p>
                    <p className="panel-copy system-url">{system.url}</p>
                    <p className="panel-copy">Status: {status}</p>
                    <p
                      className="panel-copy"
                      style={{ fontSize: "0.85em", opacity: 0.75 }}
                    >
                      Last check:{" "}
                      {system.lastChecked
                        ? new Date(system.lastChecked).toLocaleString()
                        : "No checks yet"}
                    </p>
                  </div>

                  <div className="button-row system-actions system-actions-2">
                    <button
                      className="btn btn-success system-action-btn"
                      onClick={() => handleTrigger(system.id)}
                      disabled={
                        busy === `trigger-${system.id}` ||
                        isChecking(system.id) ||
                        !can("canTriggerHealthChecks")
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
                      disabled={
                        busy === `logs-${system.id}` || !can("canViewLogs")
                      }
                    >
                      {busy === `logs-${system.id}`
                        ? "Loading..."
                        : "View Logs"}
                    </button>
                  </div>
                </article>
              );
            })}
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
              ? `System: ${logsSystemId} (auto-refreshing)`
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
