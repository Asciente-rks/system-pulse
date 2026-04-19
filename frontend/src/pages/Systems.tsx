import React, { useState } from "react";
import { createSystem, getSystemLogs, triggerHealth } from "../services/api";

export default function Systems() {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [created, setCreated] = useState<Record<string, unknown> | null>(null);
  const [triggerId, setTriggerId] = useState("");
  const [triggerResult, setTriggerResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [logsSystemId, setLogsSystemId] = useState("");
  const [logsLimit, setLogsLimit] = useState(20);
  const [logsResult, setLogsResult] = useState<Record<string, unknown> | null>(
    null,
  );
  const [busy, setBusy] = useState<"create" | "trigger" | "logs" | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    setBusy("create");
    try {
      const res = await createSystem({ name, url });
      setCreated(res);
    } finally {
      setBusy(null);
    }
  }

  async function doTrigger(e: React.FormEvent) {
    e.preventDefault();

    setBusy("trigger");
    try {
      const res = await triggerHealth(triggerId);
      setTriggerResult(res);
    } finally {
      setBusy(null);
    }
  }

  async function fetchLogs(e: React.FormEvent) {
    e.preventDefault();

    setBusy("logs");
    try {
      const res = await getSystemLogs(logsSystemId, logsLimit);
      setLogsResult(res);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack-lg">
      <section className="panel">
        <h2 className="panel-title">Register System</h2>
        <p className="panel-copy">
          Add a production base URL. Health checker calls /health first, then
          the base URL fallback.
        </p>

        <form onSubmit={submit} className="form-grid">
          <div className="form-field">
            <label className="field-label">System Name</label>
            <input
              className="field-input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="field-label">Production URL</label>
            <input
              className="field-input"
              required
              placeholder="https://your-system.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div>
            <button className="btn btn-primary" disabled={busy === "create"}>
              {busy === "create" ? "Creating..." : "Create System"}
            </button>
          </div>
        </form>

        {created && (
          <pre className="result-box">{JSON.stringify(created, null, 2)}</pre>
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title">Trigger Health Check</h2>
        <p className="panel-copy">
          Queue-based check runs immediately and retries after 90 seconds if
          still down.
        </p>

        <form onSubmit={doTrigger} className="form-grid">
          <div className="form-field">
            <label className="field-label">System ID</label>
            <input
              className="field-input"
              required
              value={triggerId}
              onChange={(e) => setTriggerId(e.target.value)}
            />
          </div>

          <div>
            <button className="btn btn-warning" disabled={busy === "trigger"}>
              {busy === "trigger" ? "Queueing..." : "Queue Health Check"}
            </button>
          </div>
        </form>

        {triggerResult && (
          <pre className="result-box">
            {JSON.stringify(triggerResult, null, 2)}
          </pre>
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title">Read Health Logs</h2>

        <form onSubmit={fetchLogs} className="form-grid form-grid-2col">
          <div className="form-field">
            <label className="field-label">System ID</label>
            <input
              className="field-input"
              required
              value={logsSystemId}
              onChange={(e) => setLogsSystemId(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="field-label">Limit</label>
            <input
              className="field-input"
              type="number"
              min={1}
              max={100}
              value={logsLimit}
              onChange={(e) => setLogsLimit(Number(e.target.value) || 20)}
            />
          </div>

          <div>
            <button className="btn btn-accent" disabled={busy === "logs"}>
              {busy === "logs" ? "Loading..." : "Get Logs"}
            </button>
          </div>
        </form>

        {logsResult && (
          <pre className="result-box">
            {JSON.stringify(logsResult, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
