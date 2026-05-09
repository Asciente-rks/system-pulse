import React from "react";
import Login from "./Login";

/**
 * Thin wrapper so the existing /register route keeps working. The
 * full sign-up flow now lives inside Login as a tabbed form.
 */
export default function Register() {
  return <Login defaultTab="register" />;
}
