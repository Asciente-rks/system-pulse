import React, { useMemo, useState } from "react";
import { acceptInvite } from "../services/api";

export default function AcceptInvite() {
  const queryToken = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }, []);

  const [token, setToken] = useState(queryToken);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    setSubmitting(true);
    try {
      const res = await acceptInvite(token, password, confirmPassword);
      setResult(res);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Accept Invitation</h2>
      <p className="panel-copy">
        Use your invite token to set your account password and activate access.
      </p>

      <form onSubmit={submit} className="form-grid">
        <div className="form-field">
          <label className="field-label">Invite Token</label>
          <input
            className="field-input"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label className="field-label">Password</label>
          <input
            type="password"
            className="field-input"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label className="field-label">Confirm Password</label>
          <input
            type="password"
            className="field-input"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        <div>
          <button className="btn btn-success" disabled={submitting}>
            {submitting ? "Submitting..." : "Activate Account"}
          </button>
        </div>
      </form>

      {result && (
        <pre className="result-box">{JSON.stringify(result, null, 2)}</pre>
      )}
    </section>
  );
}
