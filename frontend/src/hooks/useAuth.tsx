import React, { createContext, useContext, useMemo, useState } from "react";
import {
  resolveSessionPermissions,
  userCan,
  type SessionUser,
  type UserPermissions,
} from "../services/api";

interface AuthContextValue {
  user: SessionUser | null;
  isAuthenticated: boolean;
  isDemo: boolean;
  isOwner: boolean;
  permissions: UserPermissions;
  can: (key: keyof UserPermissions) => boolean;
  signIn: (nextUser: SessionUser) => void;
  signOut: () => void;
}

const SESSION_STORAGE_KEY = "systemPulseSession";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function loadUserFromStorage(): SessionUser | null {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem("role");
    localStorage.removeItem("userId");
    localStorage.removeItem("orgId");
    localStorage.removeItem("demoMode");
    return null;
  }
}

const persistAuxFields = (nextUser: SessionUser) => {
  localStorage.setItem("role", nextUser.role);
  localStorage.setItem("userId", nextUser.id);
  if (nextUser.orgId) {
    localStorage.setItem("orgId", nextUser.orgId);
  } else {
    localStorage.removeItem("orgId");
  }
  if (nextUser.demoMode) {
    localStorage.setItem("demoMode", "true");
  } else {
    localStorage.removeItem("demoMode");
  }
};

const clearAuxFields = () => {
  localStorage.removeItem("role");
  localStorage.removeItem("userId");
  localStorage.removeItem("orgId");
  localStorage.removeItem("demoMode");
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() =>
    loadUserFromStorage(),
  );

  const value = useMemo<AuthContextValue>(() => {
    const permissions = resolveSessionPermissions(user);
    return {
      user,
      isAuthenticated: Boolean(user),
      isDemo: Boolean(user?.demoMode),
      isOwner: user?.role === "owner" || user?.role === "superadmin",
      permissions,
      can: (key) => userCan(user, key),
      signIn: (nextUser) => {
        setUser(nextUser);
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextUser));
        persistAuxFields(nextUser);
      },
      signOut: () => {
        setUser(null);
        localStorage.removeItem(SESSION_STORAGE_KEY);
        clearAuxFields();
      },
    };
  }, [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }

  return context;
}
