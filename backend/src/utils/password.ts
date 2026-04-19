import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(
  password: string,
  passwordHash?: string,
): boolean {
  if (!passwordHash) {
    return false;
  }

  const [salt, storedHash] = passwordHash.split(":");
  if (!salt || !storedHash) {
    return false;
  }

  const derived = scryptSync(password, salt, 64).toString("hex");

  const lhs = Buffer.from(derived, "hex");
  const rhs = Buffer.from(storedHash, "hex");

  if (lhs.length !== rhs.length) {
    return false;
  }

  return timingSafeEqual(lhs, rhs);
}
