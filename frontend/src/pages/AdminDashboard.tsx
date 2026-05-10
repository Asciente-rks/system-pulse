import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  changeUserRole,
  createSystem,
  deleteOrg,
  deleteSystem,
  deleteUser,
  type DeploymentModeInput,
  getSystemLogs,
  getUser,
  inviteUser,
  listOrgs,
  listSystems,
  listUsers,
  ORG_DELETE_REASONS,
  ORG_SUSPEND_REASONS,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  reactivateOrg,
  suspendOrg,
  triggerHealth,
  unlockUser,
  updateSystem,
  updateUserPermissions,
  USER_DELETE_REASONS,
  USER_SUSPEND_REASONS,
  type AuthRole,
  type OrgSummary,
  type SessionUser,
  type SystemSummary,
  type UserPermissions,
} from "../services/api";
import { useAuth } from "../hooks/useAuth";
import AestheticSelect from "../components/AestheticSelect";
import {
  getSystemHealthStatus,
  normalizeHealthStatus,
  statusPillClassName,
} from "../utils/health-status";

type AdminTab = "overview" | "systems" | "users" | "platform";

const USERS_PER_PAGE = 5;
const POLL_INTERVAL_MS = 10_000;
const FAST_POLL_INTERVAL_MS = 4_000;

const DEMO_DISABLED_NOTE =
  "Demo mode is read-mostly. Sign up for a free account to delete data.";

const PERMISSIONS_NEEDING_OWNER: Array<keyof UserPermissions> = [
  "canDeleteUser",
  "canDeleteSystem",
  "canUpdateUser",
];

type UserModalTab = "access" | "permissions";

// Stable priority for sort-by-role on the Users tab. Higher tier
// (lower number) shows first.
const ROLE_RANK: Record<string, number> = {
  superadmin: 0,
  owner: 1,
  admin: 2,
  user: 3,
  tester: 4,
};

export default function AdminDashboard() {
  const { user, isDemo, isOwner, can } = useAuth();
  const isSuperAdmin = user?.role === "superadmin";

  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [systems, setSystems] = useState<SystemSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<AuthRole>("user");

  // Unlock modal
  const [unlockTarget, setUnlockTarget] = useState<SessionUser | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");

  // Platform tab (superadmin)
  const [platformOrgs, setPlatformOrgs] = useState<OrgSummary[]>([]);
  const [orgDetailTarget, setOrgDetailTarget] = useState<OrgSummary | null>(
    null,
  );
  const [orgSystemsCache, setOrgSystemsCache] = useState<
    Record<string, SystemSummary[]>
  >({});
  const [orgSystemsBusy, setOrgSystemsBusy] = useState<string | null>(null);

  // Org suspend / delete modals
  const [orgSuspendTarget, setOrgSuspendTarget] = useState<OrgSummary | null>(
    null,
  );
  const [orgSuspendReason, setOrgSuspendReason] = useState<string>(
    ORG_SUSPEND_REASONS[0],
  );
  const [orgSuspendNotes, setOrgSuspendNotes] = useState("");

  const [orgDeleteTarget, setOrgDeleteTarget] = useState<OrgSummary | null>(
    null,
  );
  const [orgDeleteReason, setOrgDeleteReason] = useState<string>(
    ORG_DELETE_REASONS[0],
  );
  const [orgDeleteNotes, setOrgDeleteNotes] = useState("");
  const [orgDeletePassword, setOrgDeletePassword] = useState("");
  const [orgDeleteConfirm, setOrgDeleteConfirm] = useState("");

  // User suspend modal (replaces the one-click toggle on suspension)
  const [userSuspendTarget, setUserSuspendTarget] =
    useState<SessionUser | null>(null);
  const [userSuspendReason, setUserSuspendReason] = useState<string>(
    USER_SUSPEND_REASONS[0],
  );
  const [userSuspendNotes, setUserSuspendNotes] = useState("");

  // Create-user modal (replaces the inline invite form)
  const [createUserOpen, setCreateUserOpen] = useState(false);

  // User-delete extras (the reason + notes ride along with the
  // existing password-confirm gate inside the user-edit modal)
  const [userDeleteReason, setUserDeleteReason] = useState<string>(
    USER_DELETE_REASONS[0],
  );
  const [userDeleteNotes, setUserDeleteNotes] = useState("");

  // Sort + filter for the Users tab.
  // `userFilter` selects WHICH users show:
  //   - all-by-name : every visible user, alphabetical
  //   - owners      : only role='owner'
  //   - admins      : only role='admin'
  //   - users       : only role='user' or 'tester' (legacy alias)
  // `sortDirection` is the secondary control rendered as a single
  // ↑/↓ button at the top-right of the user table — ascending means
  // oldest first when sorting by date, A-Z when sorting by name.
  type UserFilter = "all-by-name" | "owners" | "admins" | "users";
  const [userFilter, setUserFilter] = useState<UserFilter>("all-by-name");
  // For name mode, sensible default is A → Z (ascending). For role
  // buckets sorted by createDate, sensible default is newest first
  // (descending). We auto-reset on filter switch so the labels match
  // expectations; the user can still flip via the toolbar button.
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    setSortDirection(userFilter === "all-by-name" ? "asc" : "desc");
  }, [userFilter]);

  // Create system form
  const [systemName, setSystemName] = useState("");
  const [systemUrl, setSystemUrl] = useState("");
  const [systemDeploymentMode, setSystemDeploymentMode] =
    useState<DeploymentModeInput>("auto");

  const [logsSystemId, setLogsSystemId] = useState("");
  const [logsResult, setLogsResult] = useState<Record<string, unknown> | null>(
    null,
  );

  // Real-time polling state
  const [checkingUntilBySystem, setCheckingUntilBySystem] = useState<
    Record<string, number>
  >({});
  const [timeNow, setTimeNow] = useState(() => Date.now());

  // User pagination
  const [userPage, setUserPage] = useState(1);

  // User-edit modal
  const [editingUser, setEditingUser] = useState<SessionUser | null>(null);
  const [userModalTab, setUserModalTab] = useState<UserModalTab>("access");
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [modalSystemIds, setModalSystemIds] = useState<string[]>([]);
  const [modalStatus, setModalStatus] = useState<
    "Active" | "Pending" | "Suspended"
  >("Active");
  const [modalPermissions, setModalPermissions] = useState<UserPermissions>(
    () => buildBlankPermissions(),
  );
  const [userDeletePassword, setUserDeletePassword] = useState("");
  const [userDeleteConfirm, setUserDeleteConfirm] = useState("");

  // System-delete modal
  const [deleteSystemTarget, setDeleteSystemTarget] =
    useState<SystemSummary | null>(null);
  const [systemDeletePassword, setSystemDeletePassword] = useState("");
  const [systemDeleteConfirm, setSystemDeleteConfirm] = useState("");

  // System-edit modal
  const [editingSystem, setEditingSystem] = useState<SystemSummary | null>(
    null,
  );
  const [editSystemName, setEditSystemName] = useState("");
  const [editSystemUrl, setEditSystemUrl] = useState("");
  const [editSystemMode, setEditSystemMode] =
    useState<DeploymentModeInput>("auto");

  // Owners (and superadmins) can invite either admins or users.
  // Plain admins can only invite users — they cannot mint other
  // admins. `tester` is a legacy alias retained on the backend
  // for old data; we no longer expose it as a creation choice.
  const inviteRoleOptions = useMemo(() => {
    if (user?.role === "superadmin" || isOwner) {
      return ["admin", "user"] as const;
    }
    return ["user"] as const;
  }, [user?.role, isOwner]);

  const sortedFilteredUsers = useMemo(() => {
    let list = users;

    // Filter by role-bucket — the user's primary "Sort by" pick
    //    behaves as a filter, not a multi-key sort.
    if (userFilter === "owners") {
      list = list.filter((u) => u.role === "owner");
    } else if (userFilter === "admins") {
      list = list.filter((u) => u.role === "admin");
    } else if (userFilter === "users") {
      list = list.filter((u) => u.role === "user" || u.role === "tester");
    }

    // Sort. Name-mode sorts by full_name; role-bucket modes sort
    // by createDate so the direction toggle does its expected
    // "newest first ↔ oldest first" thing.
    const out = [...list];
    if (userFilter === "all-by-name") {
      out.sort((a, b) => a.full_name.localeCompare(b.full_name));
    } else {
      out.sort((a, b) =>
        String(b.createDate || "").localeCompare(String(a.createDate || "")),
      );
    }

    // Direction toggle.
    if (sortDirection === "asc") out.reverse();

    return out;
  }, [users, userFilter, sortDirection]);
  void ROLE_RANK; // role priority no longer used; left in case we revive it

  const totalUserPages = Math.max(
    1,
    Math.ceil(sortedFilteredUsers.length / USERS_PER_PAGE),
  );

  const pagedUsers = useMemo(() => {
    const start = (userPage - 1) * USERS_PER_PAGE;
    return sortedFilteredUsers.slice(start, start + USERS_PER_PAGE);
  }, [sortedFilteredUsers, userPage]);

  const hasPendingChecks = useMemo(
    () =>
      Object.values(checkingUntilBySystem).some((until) => until > timeNow),
    [checkingUntilBySystem, timeNow],
  );

  const loadingRef = useRef(false);

  async function loadUsersAndSystems(silent = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) {
      setBusy("load");
      setErrorMessage(null);
    }
    try {
      const [usersResponse, systemsResponse] = await Promise.all([
        listUsers(200),
        listSystems(200),
      ]);

      setUsers(usersResponse.data?.users || []);
      setSystems(systemsResponse.data?.systems || []);

      if (!silent) {
        if (usersResponse._httpStatus >= 400) {
          setErrorMessage(usersResponse.message || "Failed to load users");
        }
        if (systemsResponse._httpStatus >= 400) {
          setErrorMessage(
            systemsResponse.message || "Failed to load systems",
          );
        }
      }
    } finally {
      loadingRef.current = false;
      if (!silent) setBusy(null);
    }
  }

  useEffect(() => {
    void loadUsersAndSystems();
  }, []);

  // Tick "timeNow" every second so the "checking..." indicators update.
  useEffect(() => {
    const timer = window.setInterval(() => setTimeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Background polling. Runs at fast cadence while any system is in
  // a "checking" window, slower otherwise. This is what makes Render
  // wake-up status feel real-time without the user clicking Logs.
  useEffect(() => {
    const interval = hasPendingChecks ? FAST_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
    const id = window.setInterval(() => {
      void loadUsersAndSystems(true);
    }, interval);
    return () => window.clearInterval(id);
  }, [hasPendingChecks]);

  useEffect(() => {
    if (userPage > totalUserPages) {
      setUserPage(totalUserPages);
    }
  }, [totalUserPages, userPage]);

  // Auto-refresh logs while the logs panel is open.
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
    const interval = hasPendingChecks ? FAST_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
    const id = window.setInterval(refresh, interval);
    return () => window.clearInterval(id);
  }, [logsSystemId, hasPendingChecks]);

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
        // The backend now puts the first validation error in `message`.
        // If there's a richer `errors` array, surface up to two of
        // them so the user sees exactly which field is unhappy.
        const detail = Array.isArray((response as any).errors)
          ? (response as any).errors.slice(0, 2).join(" · ")
          : "";
        setErrorMessage(
          [String(response.message || "Invite failed"), detail]
            .filter(Boolean)
            .join(" — "),
        );
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

      // Always set a checking window so polling kicks in. For non-
      // Render systems we still need ~5 seconds because the worker
      // fires asynchronously and DDB only reflects the result after
      // it returns.
      const totalDelay = Number.isFinite(delaySeconds) && delaySeconds > 0
        ? delaySeconds + 5
        : 8;

      setCheckingUntilBySystem((current) => ({
        ...current,
        [systemId]: Date.now() + totalDelay * 1000,
      }));

      if (Number.isFinite(delaySeconds) && delaySeconds > 0) {
        setStatusMessage(
          `Health check queued for ${systemId}. Render wake-up recheck in ${delaySeconds}s.`,
        );
      } else {
        setStatusMessage(
          `Health check queued for ${systemId}. Live status will refresh shortly.`,
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
          current.map((s) =>
            s.id === systemId
              ? {
                  ...s,
                  status: normalizeHealthStatus(
                    latestLog.status,
                    latestLog.responseCode,
                  ),
                  lastChecked: latestLog.checkedAt || s.lastChecked,
                  lastResponseCode:
                    latestLog.responseCode ?? s.lastResponseCode,
                  responseTimeMs:
                    latestLog.responseTimeMs ?? s.responseTimeMs,
                }
              : s,
          ),
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
    // Switch — never stack — modals. If the user clicked Settings
    // from inside the org-detail modal, close that one first so the
    // user-edit modal owns the foreground.
    setOrgDetailTarget(null);

    try {
      const response = await getUser(nextUser.id);
      const userData = response.data || nextUser;
      setEditingUser(userData);
      setModalSystemIds(userData.allowedSystemIds || []);
      setModalStatus(userData.status_);
      setModalPermissions(
        buildPermissions(userData.permissions, userData.role),
      );
      setUserModalTab("access");
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

  function togglePermission(key: keyof UserPermissions) {
    setModalPermissions((current) => ({ ...current, [key]: !current[key] }));
  }

  async function handleSaveUserSettings() {
    if (!editingUser) return;

    setBusy("save-user-settings");
    setErrorMessage(null);

    try {
      const response = await updateUserPermissions({
        userId: editingUser.id,
        systemIds: modalSystemIds,
        status_: modalStatus,
        permissions: modalPermissions,
      });

      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Failed to update user"),
        );
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
    if (!editingUser) return;
    if (userDeleteConfirm !== "DELETE") {
      setErrorMessage("Type DELETE to confirm user deletion.");
      return;
    }

    setBusy("delete-user");
    setErrorMessage(null);

    try {
      const response = await deleteUser(editingUser.id, userDeletePassword, {
        reason: userDeleteReason,
        notes: userDeleteNotes,
      });
      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Failed to delete user"),
        );
        return;
      }
      setStatusMessage("User deleted");
      setUserModalOpen(false);
      setEditingUser(null);
      setUserDeleteReason(USER_DELETE_REASONS[0]);
      setUserDeleteNotes("");
      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

  async function handlePromote(role: AuthRole) {
    if (!editingUser) return;
    setBusy("change-role");
    setErrorMessage(null);
    try {
      const response = await changeUserRole({
        userId: editingUser.id,
        role,
      });
      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Failed to change role"),
        );
        return;
      }
      setStatusMessage(`Role updated to ${role}`);
      setUserModalOpen(false);
      setEditingUser(null);
      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

  async function loadPlatform() {
    if (!isSuperAdmin) return;
    setBusy("platform-load");
    setErrorMessage(null);
    try {
      const response = await listOrgs();
      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Failed to load organizations"),
        );
        return;
      }
      setPlatformOrgs(response.data?.orgs || []);
    } finally {
      setBusy(null);
    }
  }

  // Lazy-load the Platform tab the first time the superadmin opens it.
  useEffect(() => {
    if (activeTab === "platform" && isSuperAdmin && platformOrgs.length === 0) {
      void loadPlatform();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isSuperAdmin]);

  async function loadOrgSystems(orgId: string) {
    setOrgSystemsBusy(orgId);
    try {
      const response = await listSystems(200, { orgId });
      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Could not load org systems"),
        );
        return;
      }
      setOrgSystemsCache((current) => ({
        ...current,
        [orgId]: response.data?.systems || [],
      }));
    } finally {
      setOrgSystemsBusy(null);
    }
  }

  // Direct one-click reactivate (no reason required for the
  // friendly direction). Suspending now goes through a modal so we
  // can collect a reason + notes.
  async function handleReactivateUser(target: SessionUser) {
    setBusy(`suspend-${target.id}`);
    setErrorMessage(null);
    try {
      const response = await updateUserPermissions({
        userId: target.id,
        status_: "Active",
      });
      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Could not reactivate"),
        );
        return;
      }
      setStatusMessage(`${target.full_name} reactivated`);
      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

  function openUserSuspendModal(target: SessionUser) {
    setUserSuspendTarget(target);
    setUserSuspendReason(USER_SUSPEND_REASONS[0]);
    setUserSuspendNotes("");
  }

  async function handleSubmitUserSuspend() {
    if (!userSuspendTarget) return;
    setBusy(`suspend-${userSuspendTarget.id}`);
    setErrorMessage(null);
    try {
      const response = await updateUserPermissions({
        userId: userSuspendTarget.id,
        status_: "Suspended",
        reason: userSuspendReason,
        notes: userSuspendNotes,
      });
      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Could not suspend"),
        );
        return;
      }
      setStatusMessage(`${userSuspendTarget.full_name} suspended`);
      setUserSuspendTarget(null);
      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

  // ---- Org suspend / reactivate / delete handlers ----

  async function handleSubmitOrgSuspend() {
    if (!orgSuspendTarget) return;
    setBusy(`org-suspend-${orgSuspendTarget.id}`);
    setErrorMessage(null);
    try {
      const response = await suspendOrg({
        orgId: orgSuspendTarget.id,
        reason: orgSuspendReason,
        notes: orgSuspendNotes,
      });
      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Could not suspend organization"),
        );
        return;
      }
      setStatusMessage(`Organization "${orgSuspendTarget.name}" suspended`);
      setOrgSuspendTarget(null);
      setOrgDetailTarget(null);
      await loadPlatform();
    } finally {
      setBusy(null);
    }
  }

  async function handleReactivateOrg(org: OrgSummary) {
    setBusy(`org-reactivate-${org.id}`);
    setErrorMessage(null);
    try {
      const response = await reactivateOrg({ orgId: org.id });
      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Could not reactivate organization"),
        );
        return;
      }
      setStatusMessage(`Organization "${org.name}" reactivated`);
      await loadPlatform();
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmitOrgDelete() {
    if (!orgDeleteTarget) return;
    if (orgDeleteConfirm !== "DELETE") {
      setErrorMessage("Type DELETE to confirm.");
      return;
    }
    if (!orgDeletePassword) {
      setErrorMessage("Your password is required.");
      return;
    }
    setBusy(`org-delete-${orgDeleteTarget.id}`);
    setErrorMessage(null);
    try {
      const response = await deleteOrg({
        orgId: orgDeleteTarget.id,
        actorPassword: orgDeletePassword,
        reason: orgDeleteReason,
        notes: orgDeleteNotes,
      });
      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Could not delete organization"),
        );
        return;
      }
      const data = response.data;
      setStatusMessage(
        `Organization deleted (${data?.usersDeleted ?? 0} users, ${data?.systemsDeleted ?? 0} systems removed)`,
      );
      setOrgDeleteTarget(null);
      setOrgDetailTarget(null);
      setOrgDeletePassword("");
      setOrgDeleteConfirm("");
      setOrgDeleteNotes("");
      await loadPlatform();
      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

  async function handleUnlockSubmit() {
    if (!unlockTarget) return;
    if (!unlockPassword) {
      setErrorMessage("Enter your password to unlock the account.");
      return;
    }
    setBusy("unlock-user");
    setErrorMessage(null);
    try {
      const response = await unlockUser({
        userId: unlockTarget.id,
        actorPassword: unlockPassword,
      });
      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Could not unlock account"),
        );
        return;
      }
      setStatusMessage(`Unlocked ${unlockTarget.full_name}`);
      setUnlockTarget(null);
      setUnlockPassword("");
      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteSystem() {
    if (!deleteSystemTarget) return;
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
        setErrorMessage(
          String(response.message || "Failed to delete system"),
        );
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

  function openSystemEditor(system: SystemSummary) {
    setEditingSystem(system);
    setEditSystemName(system.name);
    setEditSystemUrl(system.url);
    setEditSystemMode((system.deploymentMode as DeploymentModeInput) || "auto");
  }

  async function handleSaveSystemEdit() {
    if (!editingSystem) return;
    setBusy("update-system");
    setErrorMessage(null);

    const payload: Parameters<typeof updateSystem>[1] = {};
    if (editSystemName !== editingSystem.name) payload.name = editSystemName;
    if (editSystemUrl !== editingSystem.url) payload.url = editSystemUrl;
    if (
      editSystemMode !==
      ((editingSystem.deploymentMode as DeploymentModeInput) || "auto")
    ) {
      payload.deploymentMode = editSystemMode;
    }

    if (Object.keys(payload).length === 0) {
      setEditingSystem(null);
      setBusy(null);
      return;
    }

    try {
      const response = await updateSystem(editingSystem.id, payload);
      if (response._httpStatus >= 400) {
        setErrorMessage(
          String(response.message || "Failed to update system"),
        );
        return;
      }
      setStatusMessage("System updated");
      setEditingSystem(null);
      await loadUsersAndSystems();
    } finally {
      setBusy(null);
    }
  }

  // Permission gates for the actor (the logged-in user).
  const canInvite = can("canCreateUser");
  const canCreateSystem = can("canCreateSystem");
  const canDeleteSystem = can("canDeleteSystem") && !isDemo;
  const canDeleteUser = can("canDeleteUser") && !isDemo;
  const canUpdateSystemPerm = can("canUpdateSystem") && !isDemo;
  const canUpdateUserPerm = can("canUpdateUser") && !isDemo;

  return (
    <div className="stack-lg">
      {isDemo && (
        <section className="panel demo-banner">
          <p className="panel-title" style={{ marginBottom: 6 }}>
            🧪 Demo mode active
          </p>
          <p className="panel-copy compact-copy">
            You're exploring real systems with destructive actions disabled.
            Sign up for a free organization to add systems you actually own.
          </p>
        </section>
      )}

      <section className="panel panel-hero">
        <div>
          <h2 className="panel-title">
            {user?.orgName
              ? `${user.orgName} — Admin Command Center`
              : "Admin Command Center"}
          </h2>
          <p className="panel-copy">
            {isOwner
              ? "You're the owner of this organization. You can promote / demote members and grant any permission."
              : "Manage users, systems, and health workflows with permission-aware controls."}
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
          {isSuperAdmin && (
            <button
              className={`tab-pill ${activeTab === "platform" ? "active" : ""}`}
              onClick={() => setActiveTab("platform")}
              title="Cross-org view (superadmin only)"
            >
              Platform
            </button>
          )}
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
                {systems.filter((item) => item.deploymentMode === "render")
                  .length}
              </p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Standard Mode Systems</p>
              <p className="metric-value">
                {systems.filter(
                  (item) =>
                    (item.deploymentMode || "standard") === "standard",
                ).length}
              </p>
            </article>
          </div>
        </section>
      )}

      {activeTab === "systems" && (
        <section className="panel">
          <h3 className="panel-subtitle">System Operations</h3>

          {canCreateSystem ? (
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
          ) : (
            <p className="panel-copy compact-copy">
              Your account doesn't have the canCreateSystem permission. Ask an
              owner to grant it.
            </p>
          )}

          {systems.length === 0 && (
            <div className="empty-state">
              <p className="empty-state-title">No systems registered yet</p>
              <p className="panel-copy compact-copy">
                {canCreateSystem
                  ? "Add your first production URL above. We'll start probing it once it's saved."
                  : "Ask an owner to add the first system. You'll see them here once they're registered."}
              </p>
            </div>
          )}

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
                    {system.lastChecked && (
                      <p
                        className="panel-copy"
                        style={{ fontSize: "0.85em", opacity: 0.75 }}
                      >
                        Last checked:{" "}
                        {new Date(system.lastChecked).toLocaleString()}
                      </p>
                    )}
                  </div>

                  <div className="button-row system-actions system-actions-4">
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
                      onClick={() => handleLoadLogs(system.id)}
                      disabled={
                        busy === `logs-${system.id}` || !can("canViewLogs")
                      }
                    >
                      {busy === `logs-${system.id}` ? "Loading..." : "Logs"}
                    </button>
                    <button
                      className="btn btn-info system-action-btn"
                      onClick={() => openSystemEditor(system)}
                      disabled={!canUpdateSystemPerm}
                      title={
                        !canUpdateSystemPerm && isDemo
                          ? DEMO_DISABLED_NOTE
                          : !canUpdateSystemPerm
                            ? "You need canUpdateSystem permission to edit"
                            : undefined
                      }
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger system-action-btn"
                      onClick={() =>
                        canDeleteSystem && setDeleteSystemTarget(system)
                      }
                      disabled={!canDeleteSystem}
                      title={
                        !canDeleteSystem && isDemo
                          ? DEMO_DISABLED_NOTE
                          : !canDeleteSystem
                            ? "You need canDeleteSystem permission to delete"
                            : undefined
                      }
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
              <p className="field-label">
                Logs for {logsSystemId} (auto-refreshing)
              </p>
              <pre className="result-box">
                {JSON.stringify(logsResult, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}

      {activeTab === "users" && (
        <section className="panel">
          <div className="modal-head">
            <h3 className="panel-subtitle">User Management</h3>
            {canInvite && (
              <button
                className="btn btn-primary"
                onClick={() => setCreateUserOpen(true)}
              >
                + Create user
              </button>
            )}
          </div>

          {!canInvite && (
            <p className="panel-copy compact-copy">
              Your account doesn't have the canCreateUser permission.
            </p>
          )}

          <div
            className="form-grid"
            style={{
              marginBottom: 12,
              gridTemplateColumns: "minmax(220px, 1fr)",
            }}
          >
            <div className="form-field">
              <label className="field-label">Sort by</label>
              <AestheticSelect
                ariaLabel="Sort users"
                value={userFilter}
                onChange={(nextValue) =>
                  setUserFilter(nextValue as typeof userFilter)
                }
                options={[
                  { value: "all-by-name", label: "Name (A–Z)" },
                  { value: "owners", label: "Owner role" },
                  { value: "admins", label: "Admin role" },
                  { value: "users", label: "User role" },
                ]}
              />
            </div>
            {isSuperAdmin && (
              <p className="panel-copy compact-copy" style={{ opacity: 0.75 }}>
                Tip: drill into a specific organization from the Platform
                tab to scope user actions to that org.
              </p>
            )}
          </div>

          <div className="table-toolbar">
            <p className="panel-copy compact-copy">
              {userFilter === "all-by-name"
                ? `Showing ${sortedFilteredUsers.length} ${
                    sortedFilteredUsers.length === 1 ? "user" : "users"
                  } alphabetically`
                : `Showing ${sortedFilteredUsers.length} ${
                    userFilter === "owners"
                      ? "owner"
                      : userFilter === "admins"
                        ? "admin"
                        : "user"
                  }${sortedFilteredUsers.length === 1 ? "" : "s"}`}
            </p>
            <button
              type="button"
              className="btn btn-muted sort-direction-btn"
              onClick={() =>
                setSortDirection((dir) =>
                  dir === "desc" ? "asc" : "desc",
                )
              }
              title={
                userFilter === "all-by-name"
                  ? sortDirection === "desc"
                    ? "Currently Z–A — click for A–Z"
                    : "Currently A–Z — click for Z–A"
                  : sortDirection === "desc"
                    ? "Newest first — click for oldest first"
                    : "Oldest first — click for newest first"
              }
              aria-label="Toggle sort direction"
            >
              <span aria-hidden style={{ fontSize: "1.1em" }}>
                {sortDirection === "desc" ? "↓" : "↑"}
              </span>
              <span style={{ marginLeft: 6 }}>
                {userFilter === "all-by-name"
                  ? sortDirection === "desc"
                    ? "Z – A"
                    : "A – Z"
                  : sortDirection === "desc"
                    ? "Newest first"
                    : "Oldest first"}
              </span>
            </button>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  {isSuperAdmin && <th>Organization</th>}
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedUsers.map((entry) => {
                  const locked = Boolean(entry.lockedAt);
                  return (
                    <tr key={entry.id}>
                      <td>{entry.full_name}</td>
                      <td>{entry.email}</td>
                      <td>
                        <span className={`role-pill role-${entry.role}`}>
                          {entry.role}
                        </span>
                      </td>
                      {isSuperAdmin && (
                        <td>
                          {(platformOrgs.find((o) => o.id === entry.orgId)
                            ?.name) ||
                            entry.orgId ||
                            "—"}
                        </td>
                      )}
                      <td>
                        {locked ? (
                          <span className="role-pill role-locked" title={`Locked at ${entry.lockedAt}`}>
                            🔒 Locked
                          </span>
                        ) : (
                          entry.status_
                        )}
                      </td>
                      <td>
                        <div className="button-row" style={{ gap: 6 }}>
                          {locked && canUpdateUserPerm && (
                            <button
                              className="btn btn-info"
                              onClick={() => {
                                setUnlockTarget(entry);
                                setUnlockPassword("");
                              }}
                            >
                              Unlock
                            </button>
                          )}
                          {canUpdateUserPerm &&
                            entry.id !== user?.id &&
                            entry.role !== "superadmin" &&
                            (entry.role !== "owner" || isSuperAdmin) && (
                              <button
                                className={`btn ${
                                  entry.status_ === "Suspended"
                                    ? "btn-success"
                                    : "btn-warning"
                                }`}
                                onClick={() => {
                                  if (entry.status_ === "Suspended") {
                                    void handleReactivateUser(entry);
                                  } else {
                                    openUserSuspendModal(entry);
                                  }
                                }}
                                disabled={busy === `suspend-${entry.id}`}
                                title={
                                  entry.status_ === "Suspended"
                                    ? "Reactivate this account"
                                    : "Suspend this account"
                                }
                              >
                                {busy === `suspend-${entry.id}`
                                  ? "..."
                                  : entry.status_ === "Suspended"
                                    ? "Activate"
                                    : "Suspend"}
                              </button>
                            )}
                          <button
                            className="btn btn-surface"
                            onClick={() => openUserSettings(entry)}
                            disabled={!canUpdateUserPerm}
                            title={
                              !canUpdateUserPerm && isDemo
                                ? DEMO_DISABLED_NOTE
                                : !canUpdateUserPerm
                                  ? "You need canUpdateUser permission"
                                  : undefined
                            }
                          >
                            Settings
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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

      {activeTab === "platform" && isSuperAdmin && (
        <section className="panel">
          <div className="modal-head">
            <div>
              <h3 className="panel-subtitle">Platform · Organizations</h3>
              <p className="panel-copy compact-copy">
                Cross-org view. You can drill into each org's members
                and delete accounts, but you can't read their personal
                details (passwords, system access lists).
              </p>
            </div>
            <button
              className="btn btn-muted"
              onClick={loadPlatform}
              disabled={busy === "platform-load"}
            >
              {busy === "platform-load" ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {platformOrgs.length === 0 ? (
            <p className="panel-copy compact-copy">
              No organizations to show yet.
            </p>
          ) : (
            <div className="grid-cards">
              {platformOrgs.map((org) => {
                const orgUsers = users.filter((u) => u.orgId === org.id);
                const isSuspended = org.status_ === "Suspended";
                return (
                  <article key={org.id} className="system-card platform-card">
                    <div>
                      <div className="platform-card-head">
                        <p className="system-title">
                          {org.name}
                          {org.isDemo && (
                            <span className="role-pill role-locked" style={{ marginLeft: 8 }}>
                              DEMO
                            </span>
                          )}
                          {isSuspended && (
                            <span className="role-pill role-locked" style={{ marginLeft: 8 }}>
                              SUSPENDED
                            </span>
                          )}
                        </p>
                        <p className="panel-copy compact-copy">
                          {org.ownerName ? (
                            <>
                              Owner: <strong>{org.ownerName}</strong>
                              {org.ownerEmail && (
                                <> · {org.ownerEmail}</>
                              )}
                            </>
                          ) : (
                            <>Owner: (unknown)</>
                          )}
                        </p>
                      </div>
                      <div className="platform-stats">
                        <span>
                          <strong>{org.memberCount}</strong> members
                        </span>
                        <span>
                          <strong>{org.systemCount}</strong> systems
                        </span>
                        {org.createDate && (
                          <span style={{ opacity: 0.7 }}>
                            Created{" "}
                            {new Date(org.createDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="button-row" style={{ gap: 8 }}>
                      <button
                        className="btn btn-info"
                        onClick={() => {
                          setOrgDetailTarget(org);
                          if (!orgSystemsCache[org.id]) {
                            void loadOrgSystems(org.id);
                          }
                        }}
                      >
                        Open organization
                      </button>
                    </div>
                    {(() => { void orgUsers; return null; })()}

                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* User edit modal */}
      {userModalOpen && editingUser && (
        <div className="modal-overlay" onClick={() => setUserModalOpen(false)}>
          <div
            className="modal-card user-settings-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-head">
              <div>
                <h3 className="panel-subtitle">{editingUser.full_name}</h3>
                <p className="panel-copy compact-copy">
                  <span className={`role-pill role-${editingUser.role}`}>
                    {editingUser.role}
                  </span>{" "}
                  · {editingUser.email}
                </p>
              </div>
              <button
                className="btn btn-muted"
                onClick={() => setUserModalOpen(false)}
              >
                Close
              </button>
            </header>

            <div className="auth-tab-strip" role="tablist">
              <button
                type="button"
                className={`auth-tab ${userModalTab === "access" ? "active" : ""}`}
                onClick={() => setUserModalTab("access")}
              >
                System access
              </button>
              <button
                type="button"
                className={`auth-tab ${userModalTab === "permissions" ? "active" : ""}`}
                onClick={() => setUserModalTab("permissions")}
              >
                Permissions
              </button>
            </div>

            {userModalTab === "access" && (
              <div className="modal-body">
                <div className="form-field">
                  <label className="field-label">Account status</label>
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

                <p className="field-label" style={{ marginTop: 12 }}>
                  Systems this user can trigger
                </p>
                {systems.length === 0 ? (
                  <p className="panel-copy compact-copy">
                    No systems registered yet.
                  </p>
                ) : (
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
              </div>
            )}

            {userModalTab === "permissions" && (
              <div className="modal-body">
                <p className="panel-copy compact-copy">
                  Toggle the actions this user can perform. Only the org
                  owner can grant permissions marked with ⚡.
                </p>

                <div className="checkbox-grid permission-grid">
                  {PERMISSION_KEYS.map((key) => {
                    const ownerOnly =
                      PERMISSIONS_NEEDING_OWNER.includes(key);
                    const disabled = ownerOnly && !isOwner;
                    return (
                      <label
                        key={key}
                        className={`checkbox-item ${disabled ? "is-disabled" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={modalPermissions[key]}
                          onChange={() => togglePermission(key)}
                          disabled={disabled}
                        />
                        <span>
                          {ownerOnly && <span aria-hidden> ⚡ </span>}
                          {PERMISSION_LABELS[key]}
                        </span>
                      </label>
                    );
                  })}
                </div>

                {isOwner && (
                  <div
                    className="modal-form-grid"
                    style={{ marginTop: 16 }}
                  >
                    <div className="form-field">
                      <label className="field-label">Change role</label>
                      <div className="button-row">
                        {(["admin", "user", "tester"] as AuthRole[]).map(
                          (role) => (
                            <button
                              key={role}
                              type="button"
                              className={`btn ${editingUser.role === role ? "btn-primary" : "btn-muted"}`}
                              disabled={
                                busy === "change-role" ||
                                editingUser.role === role ||
                                editingUser.id === user?.id
                              }
                              onClick={() => handlePromote(role)}
                            >
                              {editingUser.role === role
                                ? `Currently ${role}`
                                : `Set as ${role}`}
                            </button>
                          ),
                        )}
                      </div>
                      <p className="panel-copy compact-copy">
                        Changing role resets the permissions to that role's
                        defaults.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <footer className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleSaveUserSettings}
                disabled={busy === "save-user-settings"}
              >
                {busy === "save-user-settings"
                  ? "Saving..."
                  : "Save changes"}
              </button>
            </footer>

            <div className="danger-zone">
              <p className="danger-title">Danger zone</p>
              <p className="panel-copy compact-copy">
                Deleting a user is permanent. Type DELETE and your password
                to confirm.
              </p>

              {!canDeleteUser && (
                <p className="deletion-locked-note" role="status">
                  🔒{" "}
                  {isDemo
                    ? DEMO_DISABLED_NOTE
                    : "Your account doesn't have the canDeleteUser permission."}
                </p>
              )}

              <div className="modal-form-grid modal-danger-grid">
                <div className="form-field">
                  <label className="field-label">Reason (sent in email)</label>
                  <AestheticSelect
                    ariaLabel="Delete reason"
                    value={userDeleteReason}
                    onChange={(nextValue) =>
                      setUserDeleteReason(String(nextValue))
                    }
                    options={USER_DELETE_REASONS.map((r) => ({
                      value: r,
                      label: r,
                    }))}
                  />
                </div>
                <div className="form-field">
                  <label className="field-label">
                    Notes (optional, sent in email)
                  </label>
                  <input
                    className="field-input"
                    value={userDeleteNotes}
                    onChange={(event) =>
                      setUserDeleteNotes(event.target.value)
                    }
                    disabled={!canDeleteUser}
                    placeholder="Anything else the user should know"
                    maxLength={500}
                  />
                </div>
                <div className="form-field">
                  <label className="field-label">Type DELETE</label>
                  <input
                    className="field-input"
                    value={userDeleteConfirm}
                    onChange={(event) =>
                      setUserDeleteConfirm(event.target.value)
                    }
                    disabled={!canDeleteUser}
                  />
                </div>
                <div className="form-field">
                  <label className="field-label">Your password</label>
                  <input
                    className="field-input"
                    type="password"
                    value={userDeletePassword}
                    onChange={(event) =>
                      setUserDeletePassword(event.target.value)
                    }
                    disabled={!canDeleteUser}
                  />
                </div>
              </div>

              <button
                className="btn btn-danger"
                onClick={handleDeleteUser}
                disabled={!canDeleteUser || busy === "delete-user"}
              >
                {busy === "delete-user" ? "Deleting..." : "Delete user"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* System edit modal */}
      {editingSystem && (
        <div className="modal-overlay" onClick={() => setEditingSystem(null)}>
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-head">
              <h3 className="panel-subtitle">Edit system</h3>
              <button
                className="btn btn-muted"
                onClick={() => setEditingSystem(null)}
              >
                Close
              </button>
            </header>

            <div className="modal-body">
              <div className="form-field">
                <label className="field-label">Name</label>
                <input
                  className="field-input"
                  value={editSystemName}
                  onChange={(event) => setEditSystemName(event.target.value)}
                />
              </div>

              <div className="form-field">
                <label className="field-label">Production URL</label>
                <input
                  className="field-input"
                  value={editSystemUrl}
                  onChange={(event) => setEditSystemUrl(event.target.value)}
                />
              </div>

              <div className="form-field">
                <label className="field-label">Workflow mode</label>
                <AestheticSelect
                  ariaLabel="Workflow Mode"
                  value={editSystemMode}
                  onChange={(nextValue) => setEditSystemMode(nextValue)}
                  options={[
                    { value: "auto", label: "Auto detect from URL" },
                    { value: "render", label: "Render cold-start mode" },
                    { value: "standard", label: "Standard single-pass mode" },
                  ]}
                />
              </div>
            </div>

            <footer className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleSaveSystemEdit}
                disabled={busy === "update-system"}
              >
                {busy === "update-system" ? "Saving..." : "Save changes"}
              </button>
              <button
                className="btn btn-muted"
                onClick={() => setEditingSystem(null)}
              >
                Cancel
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Unlock account modal */}
      {unlockTarget && (
        <div
          className="modal-overlay"
          onClick={() => setUnlockTarget(null)}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="panel-subtitle">Unlock account</h3>
            <p className="panel-copy compact-copy">
              Unlock <strong>{unlockTarget.full_name}</strong>'s account
              ({unlockTarget.email}). Confirm with your password to proceed.
              The user will be able to sign in immediately afterwards.
            </p>

            <div className="form-field">
              <label className="field-label">Your password</label>
              <input
                className="field-input"
                type="password"
                value={unlockPassword}
                onChange={(event) => setUnlockPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleUnlockSubmit}
                disabled={busy === "unlock-user" || !unlockPassword}
              >
                {busy === "unlock-user" ? "Unlocking..." : "Unlock account"}
              </button>
              <button
                className="btn btn-muted"
                onClick={() => {
                  setUnlockTarget(null);
                  setUnlockPassword("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* System delete confirm modal */}
      {deleteSystemTarget && (
        <div
          className="modal-overlay"
          onClick={() => setDeleteSystemTarget(null)}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="panel-subtitle">Delete system</h3>
            <p className="panel-copy compact-copy">
              This will remove {deleteSystemTarget.name}, its logs, and all
              user access mappings.
            </p>

            {!canDeleteSystem && (
              <p className="deletion-locked-note" role="status">
                🔒{" "}
                {isDemo
                  ? DEMO_DISABLED_NOTE
                  : "Your account doesn't have the canDeleteSystem permission."}
              </p>
            )}

            <div className="form-field">
              <label className="field-label">Type DELETE</label>
              <input
                className="field-input"
                value={systemDeleteConfirm}
                onChange={(event) =>
                  setSystemDeleteConfirm(event.target.value)
                }
                disabled={!canDeleteSystem}
              />
            </div>

            <div className="form-field">
              <label className="field-label">Your password</label>
              <input
                className="field-input"
                type="password"
                value={systemDeletePassword}
                onChange={(event) =>
                  setSystemDeletePassword(event.target.value)
                }
                disabled={!canDeleteSystem}
              />
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-danger"
                onClick={handleDeleteSystem}
                disabled={!canDeleteSystem || busy === "delete-system"}
              >
                {busy === "delete-system" ? "Deleting..." : "Delete system"}
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

      {/* ---- Org detail modal (Platform tab) ---- */}
      {orgDetailTarget && (
        <div
          className="modal-overlay"
          onClick={() => setOrgDetailTarget(null)}
        >
          <div
            className="modal-card org-detail-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-head">
              <div>
                <h3 className="panel-subtitle">{orgDetailTarget.name}</h3>
                <p className="panel-copy compact-copy">
                  {orgDetailTarget.ownerName ? (
                    <>
                      Owner: <strong>{orgDetailTarget.ownerName}</strong>
                      {orgDetailTarget.ownerEmail && (
                        <> · {orgDetailTarget.ownerEmail}</>
                      )}
                    </>
                  ) : (
                    <>Owner: (unknown)</>
                  )}
                  {orgDetailTarget.status_ === "Suspended" && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="role-pill role-locked">
                        SUSPENDED
                      </span>
                    </>
                  )}
                </p>
                {orgDetailTarget.suspendedReason && (
                  <p className="panel-copy compact-copy">
                    Suspended reason: {orgDetailTarget.suspendedReason}
                    {orgDetailTarget.suspendedNotes && (
                      <> · {orgDetailTarget.suspendedNotes}</>
                    )}
                  </p>
                )}
              </div>
              <button
                className="btn btn-muted"
                onClick={() => setOrgDetailTarget(null)}
              >
                Close
              </button>
            </header>

            <div className="modal-body">
              <p className="field-label">Members</p>
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
                    {users
                      .filter((u) => u.orgId === orgDetailTarget.id)
                      .map((entry) => {
                        const locked = Boolean(entry.lockedAt);
                        return (
                          <tr key={entry.id}>
                            <td>{entry.full_name}</td>
                            <td>{entry.email}</td>
                            <td>
                              <span className={`role-pill role-${entry.role}`}>
                                {entry.role}
                              </span>
                            </td>
                            <td>
                              {locked ? (
                                <span className="role-pill role-locked">
                                  🔒 Locked
                                </span>
                              ) : (
                                entry.status_
                              )}
                            </td>
                            <td>
                              <button
                                className="btn btn-surface"
                                onClick={() => openUserSettings(entry)}
                              >
                                Settings
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    {users.filter((u) => u.orgId === orgDetailTarget.id)
                      .length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ opacity: 0.7 }}>
                          No visible members in this org.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p className="field-label" style={{ marginTop: 12 }}>
                Systems
              </p>
              {orgSystemsBusy === orgDetailTarget.id && (
                <p className="panel-copy compact-copy">Loading...</p>
              )}
              {orgSystemsBusy !== orgDetailTarget.id &&
                orgSystemsCache[orgDetailTarget.id] && (
                  <div className="grid-cards">
                    {orgSystemsCache[orgDetailTarget.id]!.map((s) => {
                      const status = getSystemHealthStatus(s);
                      return (
                        <article
                          key={s.id}
                          className="system-card"
                          style={{ padding: 14 }}
                        >
                          <div>
                            <span className={statusPillClassName(status)}>
                              {status}
                            </span>
                            <p className="system-title">{s.name}</p>
                            <p className="panel-copy system-url">{s.url}</p>
                            {s.lastChecked && (
                              <p
                                className="panel-copy"
                                style={{
                                  fontSize: "0.85em",
                                  opacity: 0.75,
                                }}
                              >
                                Last checked:{" "}
                                {new Date(s.lastChecked).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    {orgSystemsCache[orgDetailTarget.id]!.length === 0 && (
                      <p className="panel-copy compact-copy">
                        No systems registered in this org yet.
                      </p>
                    )}
                  </div>
                )}
            </div>

            {!orgDetailTarget.isInternal && (
              <footer className="modal-actions">
                {orgDetailTarget.status_ === "Suspended" ? (
                  <button
                    className="btn btn-success"
                    onClick={() => handleReactivateOrg(orgDetailTarget)}
                    disabled={
                      busy === `org-reactivate-${orgDetailTarget.id}`
                    }
                  >
                    {busy === `org-reactivate-${orgDetailTarget.id}`
                      ? "Reactivating..."
                      : "Reactivate organization"}
                  </button>
                ) : (
                  <button
                    className="btn btn-warning"
                    onClick={() => {
                      setOrgSuspendTarget(orgDetailTarget);
                      setOrgSuspendReason(ORG_SUSPEND_REASONS[0]);
                      setOrgSuspendNotes("");
                    }}
                  >
                    Suspend organization
                  </button>
                )}
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    setOrgDeleteTarget(orgDetailTarget);
                    setOrgDeleteReason(ORG_DELETE_REASONS[0]);
                    setOrgDeleteNotes("");
                    setOrgDeletePassword("");
                    setOrgDeleteConfirm("");
                  }}
                >
                  Delete organization
                </button>
              </footer>
            )}
          </div>
        </div>
      )}

      {/* ---- Org SUSPEND modal ---- */}
      {orgSuspendTarget && (
        <div
          className="modal-overlay"
          onClick={() => setOrgSuspendTarget(null)}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-head">
              <h3 className="panel-subtitle">Suspend organization</h3>
              <button
                className="btn btn-muted"
                onClick={() => setOrgSuspendTarget(null)}
              >
                Close
              </button>
            </header>
            <div className="modal-body">
              <p className="panel-copy compact-copy">
                Suspending <strong>{orgSuspendTarget.name}</strong> will
                block all members from signing in. The owner will be
                notified by email with the reason and your notes.
                Reversible.
              </p>
              <div className="form-field">
                <label className="field-label">Reason</label>
                <AestheticSelect
                  ariaLabel="Suspension reason"
                  value={orgSuspendReason}
                  onChange={(nextValue) =>
                    setOrgSuspendReason(String(nextValue))
                  }
                  options={ORG_SUSPEND_REASONS.map((r) => ({
                    value: r,
                    label: r,
                  }))}
                />
              </div>
              <div className="form-field">
                <label className="field-label">Notes (optional)</label>
                <textarea
                  className="field-input"
                  rows={3}
                  value={orgSuspendNotes}
                  onChange={(event) =>
                    setOrgSuspendNotes(event.target.value)
                  }
                  maxLength={2000}
                  placeholder="Add context the owner should see in their email"
                />
              </div>
            </div>
            <footer className="modal-actions">
              <button
                className="btn btn-warning"
                onClick={handleSubmitOrgSuspend}
                disabled={
                  busy === `org-suspend-${orgSuspendTarget.id}` ||
                  !orgSuspendReason
                }
              >
                {busy === `org-suspend-${orgSuspendTarget.id}`
                  ? "Suspending..."
                  : "Suspend organization"}
              </button>
              <button
                className="btn btn-muted"
                onClick={() => setOrgSuspendTarget(null)}
              >
                Cancel
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* ---- Org DELETE modal ---- */}
      {orgDeleteTarget && (
        <div
          className="modal-overlay"
          onClick={() => setOrgDeleteTarget(null)}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-head">
              <h3 className="panel-subtitle">Delete organization</h3>
              <button
                className="btn btn-muted"
                onClick={() => setOrgDeleteTarget(null)}
              >
                Close
              </button>
            </header>
            <div className="modal-body">
              <p className="panel-copy compact-copy">
                Deleting <strong>{orgDeleteTarget.name}</strong> will
                permanently remove the org, all of its users, all of its
                systems, and every health log. The owner will be notified
                by email before the wipe. <strong>Not reversible.</strong>
              </p>
              <div className="form-field">
                <label className="field-label">Reason</label>
                <AestheticSelect
                  ariaLabel="Deletion reason"
                  value={orgDeleteReason}
                  onChange={(nextValue) =>
                    setOrgDeleteReason(String(nextValue))
                  }
                  options={ORG_DELETE_REASONS.map((r) => ({
                    value: r,
                    label: r,
                  }))}
                />
              </div>
              <div className="form-field">
                <label className="field-label">Notes (optional)</label>
                <textarea
                  className="field-input"
                  rows={3}
                  value={orgDeleteNotes}
                  onChange={(event) =>
                    setOrgDeleteNotes(event.target.value)
                  }
                  maxLength={2000}
                  placeholder="What should the owner know about this deletion?"
                />
              </div>
              <div className="form-field">
                <label className="field-label">Type DELETE</label>
                <input
                  className="field-input"
                  value={orgDeleteConfirm}
                  onChange={(event) =>
                    setOrgDeleteConfirm(event.target.value)
                  }
                />
              </div>
              <div className="form-field">
                <label className="field-label">Your password</label>
                <input
                  className="field-input"
                  type="password"
                  value={orgDeletePassword}
                  onChange={(event) =>
                    setOrgDeletePassword(event.target.value)
                  }
                  autoComplete="current-password"
                />
              </div>
            </div>
            <footer className="modal-actions">
              <button
                className="btn btn-danger"
                onClick={handleSubmitOrgDelete}
                disabled={
                  busy === `org-delete-${orgDeleteTarget.id}` ||
                  orgDeleteConfirm !== "DELETE" ||
                  !orgDeletePassword
                }
              >
                {busy === `org-delete-${orgDeleteTarget.id}`
                  ? "Deleting..."
                  : "Delete forever"}
              </button>
              <button
                className="btn btn-muted"
                onClick={() => setOrgDeleteTarget(null)}
              >
                Cancel
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* ---- User SUSPEND modal (replaces one-click toggle) ---- */}
      {userSuspendTarget && (
        <div
          className="modal-overlay"
          onClick={() => setUserSuspendTarget(null)}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-head">
              <h3 className="panel-subtitle">
                Suspend {userSuspendTarget.full_name}
              </h3>
              <button
                className="btn btn-muted"
                onClick={() => setUserSuspendTarget(null)}
              >
                Close
              </button>
            </header>
            <div className="modal-body">
              <p className="panel-copy compact-copy">
                The user will be blocked from signing in until reactivated.
                They get an email with the reason and your notes.
              </p>
              <div className="form-field">
                <label className="field-label">Reason</label>
                <AestheticSelect
                  ariaLabel="Suspension reason"
                  value={userSuspendReason}
                  onChange={(nextValue) =>
                    setUserSuspendReason(String(nextValue))
                  }
                  options={USER_SUSPEND_REASONS.map((r) => ({
                    value: r,
                    label: r,
                  }))}
                />
              </div>
              <div className="form-field">
                <label className="field-label">Notes (optional)</label>
                <textarea
                  className="field-input"
                  rows={3}
                  value={userSuspendNotes}
                  onChange={(event) =>
                    setUserSuspendNotes(event.target.value)
                  }
                  maxLength={2000}
                  placeholder="Add context the user should see in their email"
                />
              </div>
            </div>
            <footer className="modal-actions">
              <button
                className="btn btn-warning"
                onClick={handleSubmitUserSuspend}
                disabled={
                  busy === `suspend-${userSuspendTarget.id}` ||
                  !userSuspendReason
                }
              >
                {busy === `suspend-${userSuspendTarget.id}`
                  ? "Suspending..."
                  : "Suspend account"}
              </button>
              <button
                className="btn btn-muted"
                onClick={() => setUserSuspendTarget(null)}
              >
                Cancel
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* ---- Create user modal ---- */}
      {createUserOpen && (
        <div
          className="modal-overlay"
          onClick={() => setCreateUserOpen(false)}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-head">
              <h3 className="panel-subtitle">Invite a new user</h3>
              <button
                className="btn btn-muted"
                onClick={() => setCreateUserOpen(false)}
              >
                Close
              </button>
            </header>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                await handleInvite(event);
                if (!errorMessage) {
                  setCreateUserOpen(false);
                }
              }}
              className="modal-body form-grid form-grid-2col"
            >
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
                <label className="field-label">Full name</label>
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
                  onChange={(nextValue) =>
                    setInviteRole(nextValue as AuthRole)
                  }
                  options={inviteRoleOptions.map((role) => ({
                    value: role,
                    label: role,
                  }))}
                />
              </div>
              <div className="form-field form-action-field">
                <label className="field-label">&nbsp;</label>
                <button
                  className="btn btn-primary"
                  disabled={busy === "invite"}
                >
                  {busy === "invite" ? "Sending..." : "Send invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------- helpers -----------------

function buildBlankPermissions(): UserPermissions {
  return {
    canCreateUser: false,
    canDeleteUser: false,
    canUpdateUser: false,
    canCreateSystem: false,
    canDeleteSystem: false,
    canUpdateSystem: false,
    canTriggerHealthChecks: true,
    canViewLogs: true,
  };
}

function buildPermissions(
  source: UserPermissions | undefined,
  role: AuthRole,
): UserPermissions {
  const blank = buildBlankPermissions();
  if (source) {
    return { ...blank, ...source };
  }
  // Fall back to role defaults if nothing is stored.
  if (role === "owner" || role === "superadmin") {
    return {
      canCreateUser: true,
      canDeleteUser: true,
      canUpdateUser: true,
      canCreateSystem: true,
      canDeleteSystem: true,
      canUpdateSystem: true,
      canTriggerHealthChecks: true,
      canViewLogs: true,
    };
  }
  if (role === "admin") {
    return {
      canCreateUser: true,
      canDeleteUser: false,
      canUpdateUser: true,
      canCreateSystem: true,
      canDeleteSystem: false,
      canUpdateSystem: true,
      canTriggerHealthChecks: true,
      canViewLogs: true,
    };
  }
  return blank;
}
