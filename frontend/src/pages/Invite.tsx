import React, { useState } from "react";
import { inviteUser } from "../services/api";

type InviteRole = "tester" | "admin" | "superadmin";

const isInviteRole = (value: string): value is InviteRole => {
  return value === "tester" || value === "admin" || value === "superadmin";
};

export default function Invite() {
  const [email, setEmail] = useState("");
  const [full_name, setFullName] = useState("");
  const [role, setRole] = useState<InviteRole>("tester");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    setSubmitting(true);
    try {
      const payload = { email, full_name, role };
      const res = await inviteUser(payload);
      setResult(res);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Invite User</h2>
      <p className="panel-copy">
        Superadmin can invite admins and testers. Admin can invite testers.
      </p>

      <form onSubmit={submit} className="form-grid">
        <div className="form-field">
          <label className="field-label">Email</label>
          <input
            className="field-input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label className="field-label">Full name</label>
          <input
            className="field-input"
            required
            value={full_name}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label className="field-label">Role</label>
          <select
            className="field-input"
            value={role}
            onChange={(e) => {
              const nextRole = e.target.value;
              if (isInviteRole(nextRole)) {
                setRole(nextRole);
              }
            }}
          >
            <option value="tester">tester</option>
            <option value="admin">admin</option>
            <option value="superadmin">superadmin</option>
          </select>
        </div>

        <div>
          <button className="btn btn-primary" disabled={submitting}>
            {submitting ? "Sending..." : "Send Invitation"}
          </button>
        </div>
      </form>

      {result && (
        <pre className="result-box">{JSON.stringify(result, null, 2)}</pre>
      )}
    </section>
  );
}
