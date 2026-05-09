import React from "react";
import Login from "./Login";

/**
 * Thin wrapper so the existing /forgot-password route keeps working.
 * The forgot-password form now lives inside Login as a tabbed form.
 */
export default function ForgotPassword() {
  return <Login defaultTab="forgot" />;
}
