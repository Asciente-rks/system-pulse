import React from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import Nav from "./components/Nav";
import { useAuth } from "./hooks/useAuth";
import AcceptInvite from "./pages/AcceptInvite";
import Login from "./pages/Login";
import AdminDashboard from "./pages/AdminDashboard";
import TesterDashboard from "./pages/TesterDashboard";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function RequireRoles({
  roles,
  children,
}: {
  roles: Array<"superadmin" | "admin" | "tester">;
  children: JSX.Element;
}) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!roles.includes(user.role)) {
    if (user.role === "tester") {
      return <Navigate to="/tester" replace />;
    }

    return <Navigate to="/admin" replace />;
  }

  return children;
}

function DefaultRoute() {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === "tester") {
    return <Navigate to="/tester" replace />;
  }

  return <Navigate to="/admin" replace />;
}

function AppShell() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const showNav =
    isAuthenticated &&
    location.pathname !== "/login" &&
    location.pathname !== "/accept-invite" &&
    location.pathname !== "/forgot-password" &&
    location.pathname !== "/reset-password";

  return (
    <div className="app-shell">
      <div className="bg-aura" />
      {showNav && (
        <header className="topbar">
          <div className="container-wrap">
            <Nav />
          </div>
        </header>
      )}

      <main className="container-wrap page-content">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route
            path="/admin"
            element={
              <RequireAuth>
                <RequireRoles roles={["superadmin", "admin"]}>
                  <AdminDashboard />
                </RequireRoles>
              </RequireAuth>
            }
          />

          <Route
            path="/tester"
            element={
              <RequireAuth>
                <RequireRoles roles={["tester"]}>
                  <TesterDashboard />
                </RequireRoles>
              </RequireAuth>
            }
          />

          <Route path="/" element={<DefaultRoute />} />
          <Route path="*" element={<DefaultRoute />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
