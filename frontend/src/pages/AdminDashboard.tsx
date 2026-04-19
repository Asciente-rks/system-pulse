import React, { useEffect, useMemo, useState } from "react";
import {
  assignSystemAccess,
  createSystem,
  deleteSystem,
  deleteUser,
  type DeploymentModeInput,
  getSystemLogs,
  getUser,
  inviteUser,
  listSystems,
  listUsers,
  triggerHealth,
  type SessionUser,
  type SystemSummary,
} from "../services/api";
import { useAuth } from "../hooks/useAuth";
import AestheticSelect from "../components/AestheticSelect";
import {
  getSystemHealthStatus,
  normalizeHealthStatus,
  statusPillClassName,
} from "../utils/health-status";

type AdminTab = "overview" | "systems" | "users";

const USERS_PER_PAGE = 5;

export default function AdminDashboard() {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [systems, setSystems] = useState<SystemSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "tester">("tester");

  const [systemName, setSystemName] = useState("");
  const [systemUrl, setSystemUrl] = useState("");
  const [systemDeploymentMode, setSystemDeploymentMode] =
    useState<DeploymentModeInput>("auto");

  const [logsSystemId, setLogsSystemId] = useState("");
  const [logsResult, setLogsResult] = useState<Record<string, unknown> | null>(
    null,
  );

  const [checkingUntilBySystem, setCheckingUntilBySystem] = useState<
    Record<string, number>
  >({});
  const [timeNow, setTimeNow] = useState(() => Date.now());

  const [userPage, setUserPage] = useState(1);
  const [editingUser, setEditingUser] = useState<SessionUser | null>(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [showPermissionEditor, setShowPermissionEditor] = useState(false);
  const [modalSystemIds, setModalSystemIds] = useState<string[]>([]);
  const [modalStatus, setModalStatus] = useState<
    "Active" | "Pending" | "Suspended"
  >("Active");
  const [userDeletePassword, setUserDeletePassword] = useState("");
  const [userDeleteConfirm, setUserDeleteConfirm] = useState("");

  const [deleteSystemTarget, setDeleteSystemTarget] =
    useState<SystemSummary | null>(null);
  const [systemDeletePassword, setSystemDeletePassword] = useState("");
  const [systemDeleteConfirm, setSystemDeleteConfirm] = useState("");

  const inviteRoleOptions = useMemo(() => {
    if (user?.role === "superadmin") {
      return ["admin", "tester"] as const;
    }

    return ["tester"] as const;
  }, [user?.role]);

  const totalUserPages = Math.max(1, Math.ceil(users.length / USERS_PER_PAGE));

  const pagedUsers = useMemo(() => {
    const start = (userPage - 1) * USERS_PER_PAGE;
    return users.slice(start, start + USERS_PER_PAGE);
  }, [users, userPage]);

  async function loadUsersAndSystems() {
    setBusy("load");
    setErrorMessage(null);

    try {
      const [usersResponse, systemsResponse] = await Promise.all([
        listUsers(200),
        listSystems(200),
      ]);

      setUsers(usersResponse.data?.users || []);
      setSystems(systemsResponse.data?.systems || []);

      if (usersResponse._httpStatus >= 400) {
        setErrorMessage(usersResponse.message || "Failed to load users");
      }

      if (systemsResponse._httpStatus >= 400) {
        setErrorMessage(systemsResponse.message || "Failed to load systems");
      }
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadUsersAndSystems();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTimeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (userPage > totalUserPages) {
      setUserPage(totalUserPages);
    }
  }, [totalUserPages, userPage]);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setBusy("invite");
    setErrorMessage(null);

    try {
      const response = await inviteUser({
        email: inviteEmail,
        full_name: inviteName,
        role: inviteRole,
      });

      if (response._httpStatus >= 400) {
        setErrorMessage(String(response.message || "Invite failed"));
        return;
      }

      setInviteEmail("");
      setInviteName("");
      setInviteRole(inviteRoleOptions[0]);
      setStatusMessage(String(response.message || "Invitation sent"));
      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateSystem(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create-system");
    setErrorMessage(null);

    try {
      const response = await createSystem({
        name: systemName,
        url: systemUrl,
        deploymentMode: systemDeploymentMode,
      });

      if (response._httpStatus >= 400) {
        setErrorMessage(String(response.message || "Create system failed"));
        return;
      }

      setSystemName("");
      setSystemUrl("");
      setSystemDeploymentMode("auto");
      setStatusMessage("System created");
      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

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

      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

  function isChecking(systemId: string) {
    const until = checkingUntilBySystem[systemId] || 0;
    return until > timeNow;
  }

  async function handleLoadLogs(systemId: string) {
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
          current.map((system) => {
            if (system.id !== systemId) {
              return system;
            }

            return {
              ...system,
              status: normalizeHealthStatus(
                latestLog.status,
                latestLog.responseCode,
              ),
              lastChecked: latestLog.checkedAt || system.lastChecked,
              lastResponseCode:
                latestLog.responseCode ?? system.lastResponseCode,
              responseTimeMs: latestLog.responseTimeMs ?? system.responseTimeMs,
            };
          }),
        );
      }

      setActiveTab("systems");
    } finally {
      setBusy(null);
    }
  }

  async function openUserSettings(nextUser: SessionUser) {
    setBusy("open-user-settings");
    setErrorMessage(null);

    try {
      const response = await getUser(nextUser.id);
      const userData = response.data || nextUser;

      setEditingUser(userData);
      setModalSystemIds(userData.allowedSystemIds || []);
      setModalStatus(userData.status_);
      setShowPermissionEditor(false);
      setUserDeletePassword("");
      setUserDeleteConfirm("");
      setUserModalOpen(true);
    } finally {
      setBusy(null);
    }
  }

  function toggleSystemForModal(systemId: string) {
    setModalSystemIds((current) => {
      if (current.includes(systemId)) {
        return current.filter((item) => item !== systemId);
      }

      return [...current, systemId];
    });
  }

  async function handleSaveUserSettings() {
    if (!editingUser) {
      return;
    }

    setBusy("save-user-settings");
    setErrorMessage(null);

    try {
      const response = await assignSystemAccess({
        userId: editingUser.id,
        systemIds: modalSystemIds,
        status_: modalStatus,
      });

      if (response._httpStatus >= 400) {
        setErrorMessage(String(response.message || "Failed to update user"));
        return;
      }

      setStatusMessage("User settings updated");
      setUserModalOpen(false);
      setEditingUser(null);
      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteUser() {
    if (!editingUser) {
      return;
    }

    if (userDeleteConfirm !== "DELETE") {
      setErrorMessage("Type DELETE to confirm user deletion.");
      return;
    }

    setBusy("delete-user");
    setErrorMessage(null);

    try {
      const response = await deleteUser(editingUser.id, userDeletePassword);

      if (response._httpStatus >= 400) {
        setErrorMessage(String(response.message || "Failed to delete user"));
        return;
      }

      setStatusMessage("User deleted");
      setUserModalOpen(false);
      setEditingUser(null);
      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteSystem() {
    if (!deleteSystemTarget) {
      return;
    }

    if (systemDeleteConfirm !== "DELETE") {
      setErrorMessage("Type DELETE to confirm system deletion.");
      return;
    }

    setBusy("delete-system");
    setErrorMessage(null);

    try {
      const response = await deleteSystem(
        deleteSystemTarget.id,
        systemDeletePassword,
      );

      if (response._httpStatus >= 400) {
        setErrorMessage(String(response.message || "Failed to delete system"));
        return;
      }

      setStatusMessage("System deleted");
      setDeleteSystemTarget(null);
      setSystemDeletePassword("");
      setSystemDeleteConfirm("");
      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack-lg">
      <section className="panel panel-hero">
        <div>
          <h2 className="panel-title">Admin Command Center</h2>
          <p className="panel-copy">
            Manage users, systems, and health workflows with role-aware controls
            and secure deletion safeguards.
          </p>
        </div>

        <div className="dashboard-tabs">
          <button
            className={`tab-pill ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            Overview
          </button>
          <button
            className={`tab-pill ${activeTab === "systems" ? "active" : ""}`}
            onClick={() => setActiveTab("systems")}
          >
            Systems
          </button>
          <button
            className={`tab-pill ${activeTab === "users" ? "active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            Users
          </button>
        </div>

        {statusMessage && <p className="status-note">{statusMessage}</p>}
        {errorMessage && <p className="status-error">{errorMessage}</p>}
      </section>

      {activeTab === "overview" && (
        <section className="panel">
          <div className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">Visible Users</p>
              <p className="metric-value">{users.length}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Registered Systems</p>
              <p className="metric-value">{systems.length}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Render Mode Systems</p>
              <p className="metric-value">
                {
                  systems.filter((item) => item.deploymentMode === "render")
                    .length
                }
              </p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Standard Mode Systems</p>
              <p className="metric-value">
                {
                  systems.filter(
                    (item) =>
                      (item.deploymentMode || "standard") === "standard",
                  ).length
                }
              </p>
            </article>
          </div>
        </section>
      )}

      {activeTab === "systems" && (
        <section className="panel">
          <h3 className="panel-subtitle">System Operations</h3>
          <form
            onSubmit={handleCreateSystem}
            className="form-grid form-grid-4col"
          >
            <div className="form-field">
              <label className="field-label">System Name</label>
              <input
                className="field-input"
                value={systemName}
                onChange={(event) => setSystemName(event.target.value)}
                required
              />
            </div>

            <div className="form-field">
              <label className="field-label">Production URL</label>
              <input
                className="field-input"
                value={systemUrl}
                onChange={(event) => setSystemUrl(event.target.value)}
                required
              />
            </div>

            <div className="form-field">
              <label className="field-label">Workflow Mode</label>
              <AestheticSelect
                ariaLabel="Workflow Mode"
                value={systemDeploymentMode}
                onChange={(nextValue) => setSystemDeploymentMode(nextValue)}
                options={[
                  { value: "auto", label: "Auto detect from URL" },
                  { value: "render", label: "Render cold-start mode" },
                  { value: "standard", label: "Standard single-pass mode" },
                ]}
              />
            </div>

            <div className="form-field form-action-field">
              <label className="field-label">&nbsp;</label>
              <button
                className="btn btn-primary"
                disabled={busy === "create-system"}
              >
                {busy === "create-system" ? "Creating..." : "Create System"}
              </button>
            </div>
          </form>

          <div className="grid-cards">
            {systems.map((system) => {
              const status = getSystemHealthStatus(system);

              return (
                <article className="system-card" key={system.id}>
                  <div>
                    <span className={statusPillClassName(status)}>
                      {status}
                    </span>
                    <p className="system-title">{system.name}</p>
                    <p className="panel-copy system-url">{system.url}</p>
                    <p className="panel-copy">
                      Workflow: {system.deploymentMode || "standard"}
                    </p>
                    <p className="panel-copy">Status: {status}</p>
                  </div>

                  <div className="button-row system-actions system-actions-3">
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
                      onClick={() => handleLoadLogs(system.id)}
                      disabled={busy === `logs-${system.id}`}
                    >
                      {busy === `logs-${system.id}` ? "Loading..." : "Logs"}
                    </button>
                    <button
                      className="btn btn-danger system-action-btn"
                      onClick={() => setDeleteSystemTarget(system)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {logsResult && (
            <div className="result-wrap">
              <p className="field-label">Logs for {logsSystemId}</p>
              <pre className="result-box">
                {JSON.stringify(logsResult, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}

      {activeTab === "users" && (
        <section className="panel">
          <h3 className="panel-subtitle">User Management</h3>

          <form onSubmit={handleInvite} className="form-grid form-grid-4col">
            <div className="form-field">
              <label className="field-label">Email</label>
              <input
                className="field-input"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                required
              />
            </div>

            <div className="form-field">
              <label className="field-label">Full Name</label>
              <input
                className="field-input"
                value={inviteName}
                onChange={(event) => setInviteName(event.target.value)}
                required
              />
            </div>

            <div className="form-field">
              <label className="field-label">Role</label>
              <AestheticSelect
                ariaLabel="Role"
                value={inviteRole}
                onChange={(nextValue) => setInviteRole(nextValue)}
                options={inviteRoleOptions.map((role) => ({
                  value: role,
                  label: role,
                }))}
              />
            </div>

            <div className="form-field form-action-field">
              <label className="field-label">&nbsp;</label>
              <button className="btn btn-primary" disabled={busy === "invite"}>
                {busy === "invite" ? "Sending..." : "Send Invite"}
              </button>
            </div>
          </form>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedUsers.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.full_name}</td>
                    <td>{entry.email}</td>
                    <td>{entry.role}</td>
                    <td>{entry.status_}</td>
                    <td>
                      <button
                        className="btn btn-surface"
                        onClick={() => openUserSettings(entry)}
                      >
                        Settings
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination-row">
            <button
              className="btn btn-muted"
              onClick={() => setUserPage((page) => Math.max(1, page - 1))}
              disabled={userPage === 1}
            >
              Previous
            </button>
            <p className="panel-copy compact-copy">
              Page {userPage} of {totalUserPages}
            </p>
            <button
              className="btn btn-muted"
              onClick={() =>
                setUserPage((page) => Math.min(totalUserPages, page + 1))
              }
              disabled={userPage === totalUserPages}
            >
              Next
            </button>
          </div>
        </section>
      )}

      {userModalOpen && editingUser && (
        <div className="modal-overlay">
          <div className="modal-card user-settings-modal">
            <h3 className="panel-subtitle">User Settings</h3>
            <p className="panel-copy compact-copy">
              {editingUser.full_name} ({editingUser.role})
            </p>

            <div className="modal-form-grid">
              <div className="form-field">
                <label className="field-label">Status</label>
                <AestheticSelect
                  ariaLabel="Status"
                  value={modalStatus}
                  onChange={(nextValue) => setModalStatus(nextValue)}
                  options={[
                    { value: "Active", label: "Active" },
                    { value: "Pending", label: "Pending" },
                    { value: "Suspended", label: "Suspended" },
                  ]}
                />
              </div>

              <div className="form-field form-action-field">
                <label className="field-label">Permissions</label>
                <button
                  className="btn btn-surface"
                  onClick={() => setShowPermissionEditor((current) => !current)}
                >
                  {showPermissionEditor
                    ? "Hide System Trigger Permissions"
                    : "Edit System Trigger Permissions"}
                </button>
              </div>
            </div>

            {showPermissionEditor && (
              <div className="checkbox-grid permission-grid">
                {systems.map((system) => (
                  <label key={system.id} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={modalSystemIds.includes(system.id)}
                      onChange={() => toggleSystemForModal(system.id)}
                    />
                    <span>{system.name}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="button-row modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleSaveUserSettings}
                disabled={busy === "save-user-settings"}
              >
                {busy === "save-user-settings" ? "Saving..." : "Save Settings"}
              </button>
              <button
                className="btn btn-muted"
                onClick={() => {
                  setUserModalOpen(false);
                  setEditingUser(null);
                }}
              >
                Close
              </button>
            </div>

            <div className="danger-zone">
              <p className="danger-title">Danger Zone</p>
              <p className="panel-copy compact-copy">
                Deleting a user is permanent. Type DELETE and your admin
                password.
              </p>

              <div className="modal-form-grid modal-danger-grid">
                <div className="form-field">
                  <label className="field-label">Type DELETE</label>
                  <input
                    className="field-input"
                    value={userDeleteConfirm}
                    onChange={(event) =>
                      setUserDeleteConfirm(event.target.value)
                    }
                  />
                </div>

                <div className="form-field">
                  <label className="field-label">Your Password</label>
                  <input
                    className="field-input"
                    type="password"
                    value={userDeletePassword}
                    onChange={(event) =>
                      setUserDeletePassword(event.target.value)
                    }
                  />
                </div>
              </div>

              <button
                className="btn btn-danger"
                onClick={handleDeleteUser}
                disabled={busy === "delete-user"}
              >
                {busy === "delete-user" ? "Deleting..." : "Delete User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteSystemTarget && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3 className="panel-subtitle">Delete System</h3>
            <p className="panel-copy compact-copy">
              This will remove {deleteSystemTarget.name}, its logs, and all user
              access mappings.
            </p>

            <div className="form-field">
              <label className="field-label">Type DELETE</label>
              <input
                className="field-input"
                value={systemDeleteConfirm}
                onChange={(event) => setSystemDeleteConfirm(event.target.value)}
              />
            </div>

            <div className="form-field">
              <label className="field-label">Your Password</label>
              <input
                className="field-input"
                type="password"
                value={systemDeletePassword}
                onChange={(event) =>
                  setSystemDeletePassword(event.target.value)
                }
              />
            </div>

            <div className="button-row">
              <button
                className="btn btn-danger"
                onClick={handleDeleteSystem}
                disabled={busy === "delete-system"}
              >
                {busy === "delete-system" ? "Deleting..." : "Delete System"}
              </button>
              <button
                className="btn btn-muted"
                onClick={() => {
                  setDeleteSystemTarget(null);
                  setSystemDeletePassword("");
                  setSystemDeleteConfirm("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
