import validator from "validator";

/**
 * Hostnames + IP ranges that the health checker MUST refuse to call.
 *
 * The worker is an AWS Lambda. Without this guard a user could
 * register `http://169.254.169.254/latest/meta-data/` and have the
 * Lambda exfiltrate IAM credentials on their behalf, or hammer
 * internal services on `http://localhost:8080`. Both are classic
 * SSRF vectors. This is enforced on:
 *
 *   1. system creation (yup schema → assertSafeUrl)
 *   2. every probe call (defense-in-depth: stops late DNS rebinding
 *      and the legacy systems that pre-date this guard).
 */
const BLOCKED_HOSTS = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

/**
 * IPv4 ranges expressed as `[startInt, endInt]` pairs. The integers
 * are big-endian 32-bit representations.
 */
const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  [ipv4ToInt("0.0.0.0"), ipv4ToInt("0.255.255.255")],         // unspecified
  [ipv4ToInt("10.0.0.0"), ipv4ToInt("10.255.255.255")],       // RFC1918
  [ipv4ToInt("100.64.0.0"), ipv4ToInt("100.127.255.255")],    // CGNAT
  [ipv4ToInt("127.0.0.0"), ipv4ToInt("127.255.255.255")],     // loopback
  [ipv4ToInt("169.254.0.0"), ipv4ToInt("169.254.255.255")],   // link-local + AWS metadata
  [ipv4ToInt("172.16.0.0"), ipv4ToInt("172.31.255.255")],     // RFC1918
  [ipv4ToInt("192.0.0.0"), ipv4ToInt("192.0.0.255")],         // IETF protocol assignments
  [ipv4ToInt("192.168.0.0"), ipv4ToInt("192.168.255.255")],   // RFC1918
  [ipv4ToInt("198.18.0.0"), ipv4ToInt("198.19.255.255")],     // benchmark
  [ipv4ToInt("224.0.0.0"), ipv4ToInt("239.255.255.255")],     // multicast
  [ipv4ToInt("240.0.0.0"), ipv4ToInt("255.255.255.255")],     // reserved
];

const BLOCKED_IPV6_PREFIXES = [
  "::",          // unspecified
  "::1",         // loopback
  "fc",          // unique-local fc00::/7 (matches "fc" or "fd")
  "fd",
  "fe80",        // link-local
  "fe9",         // link-local extended (fe80::/10 covers fe80..febf)
  "fea",
  "feb",
  "ff",          // multicast ff00::/8
];

function ipv4ToInt(addr: string): number {
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return -1;
  }
  // Use unsigned arithmetic via >>> 0 to keep values in [0, 2^32).
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

function isBlockedIpv4(addr: string): boolean {
  const value = ipv4ToInt(addr);
  if (value < 0) return false;
  return BLOCKED_IPV4_RANGES.some(
    ([start, end]) => value >= start && value <= end,
  );
}

function isBlockedIpv6(addr: string): boolean {
  const lower = addr.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::" || lower === "::1") return true;
  return BLOCKED_IPV6_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Returns `null` if the URL is safe to fetch externally, or a string
 * describing the reason it's blocked.
 */
export function urlSafetyError(rawUrl: string): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return "URL is required";
  }

  if (rawUrl.length > 2048) {
    return "URL is too long";
  }

  // validator.isURL gives us a stricter shape check (rejects file://,
  // javascript:, gopher:, etc.) when we restrict the protocol set.
  const ok = validator.isURL(rawUrl, {
    protocols: ["http", "https"],
    require_protocol: true,
    require_valid_protocol: true,
    require_host: true,
    allow_underscores: true,
    disallow_auth: true,
  });

  if (!ok) {
    return "URL must be http(s) and include a valid host";
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "URL could not be parsed";
  }

  if (parsed.username || parsed.password) {
    return "URL must not include credentials";
  }

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) {
    return `Host '${host}' is blocked`;
  }

  if (validator.isIP(host, 4) && isBlockedIpv4(host)) {
    return `IP address '${host}' is in a blocked range`;
  }

  if (validator.isIP(host, 6) && isBlockedIpv6(host)) {
    return `IP address '${host}' is in a blocked range`;
  }

  // Many SSRF attacks use bracket-encoded IPv6: http://[::1]/
  if (host.startsWith("[") && host.endsWith("]")) {
    const inner = host.slice(1, -1);
    if (validator.isIP(inner, 6) && isBlockedIpv6(inner)) {
      return `IP address '${inner}' is in a blocked range`;
    }
  }

  return null;
}

/**
 * Throwing variant for use in services. Throws a `RangeError` so
 * callers can distinguish from generic validation errors if needed.
 */
export function assertSafeUrl(rawUrl: string): void {
  const reason = urlSafetyError(rawUrl);
  if (reason) {
    throw new RangeError(`Unsafe URL: ${reason}`);
  }
}
