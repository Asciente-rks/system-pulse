import React, { useState } from "react";
import { assignSystemAccess } from "../services/api";

export default function AssignAccess() {
  const [userId, setUserId] = useState("");
  const [systemIds, setSystemIds] = useState("");
  const [status, setStatus] = useState<"" | "Active" | "Pending" | "Suspended">(
    "",
  );
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    const ids = systemIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setSubmitting(true);
    try {
      const res = await assignSystemAccess({
        userId,
        systemIds: ids,
        status_: status || undefined,
      });
      setResult(res);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Assign System Access</h2>
      <p className="panel-copy">
        Admin and superadmin can set user system access and optional account
        status in one request.
      </p>

      <form onSubmit={submit} className="form-grid">
        <div className="form-field">
          <label className="field-label">User ID</label>
          <input
            className="field-input"
            required
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label className="field-label">System IDs (comma separated)</label>
          <input
            className="field-input"
            placeholder="system-id-1, system-id-2"
            value={systemIds}
            onChange={(e) => setSystemIds(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label className="field-label">Optional status update</label>
          <select
            className="field-input"
            value={status}
            onChange={(e) =>
              setStatus(
                e.target.value as "" | "Active" | "Pending" | "Suspended",
              )
            }
          >
            <option value="">No status change</option>
            <option value="Active">Active</option>
            <option value="Pending">Pending</option>
            <option value="Suspended">Suspended</option>
          </select>
        </div>

        <div>
          <button className="btn btn-accent" disabled={submitting}>
            {submitting ? "Updating..." : "Update Access"}
          </button>
        </div>
      </form>

      {result && (
        <pre className="result-box">{JSON.stringify(result, null, 2)}</pre>
      )}
    </section>
  );
}
