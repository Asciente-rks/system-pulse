import * as yup from "yup";
import { urlSafetyError } from "../utils/url-safety.js";

/**
 * URL test that runs the SSRF safety check inline. Yup's built-in
 * `.url()` is too lax for a system that fetches the URL — it lets
 * `file://`, `javascript:`, link-local IPs, AWS metadata, and
 * loopback through. `urlSafetyError` blocks all of those.
 */
const safeUrlTest = yup
  .string()
  .required("URL is required")
  .test("safe-url", function (value) {
    const reason = urlSafetyError(value || "");
    if (reason) {
      return this.createError({ message: reason });
    }
    return true;
  })
  .max(2048, "URL is too long");

export const createHealthSchema = yup.object({
  name: yup
    .string()
    .required("Name is required")
    .min(2, "Name too short")
    .max(80, "Name too long"),
  url: safeUrlTest,
  deploymentMode: yup
    .mixed<"auto" | "render" | "standard">()
    .oneOf(["auto", "render", "standard"]),
});

export const updateHealthSchema = yup.object({
  name: yup.string().min(2).max(80),
  url: safeUrlTest.notRequired(),
});
