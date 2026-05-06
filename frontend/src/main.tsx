import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { ThemeProvider } from "./hooks/useTheme";
import { installSecurityHardening } from "./utils/security";
import "./styles/index.css";

installSecurityHardening();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
