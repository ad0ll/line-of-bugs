import "server-only";

import bcrypt from "bcrypt";
import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";

export type BasicCreds = { user: string; password: string };

export function parseBasicAuth(header: string | null): BasicCreds | null {
  if (!header || !header.startsWith("Basic ")) return null;
  const encoded = header.slice(6);
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  return {
    user: decoded.slice(0, idx),
    password: decoded.slice(idx + 1),
  };
}

export const ADMIN_USER = "admin";

export function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

/**
 * Resolves the bcrypt admin hash from env. Prefers ADMIN_PASSWORD_HASH_B64
 * (base64 of the hash) over ADMIN_PASSWORD_HASH (raw).
 *
 * Why two vars: dotenv-expand (used by Next.js's runtime env loader) treats
 * the bcrypt-hash's `$2b` / `$10` / `$<salt>` segments as variable references
 * and silently substitutes them out, corrupting the hash to a 10-char tail.
 * Backslash-escapes in the .env file get un-escaped then re-expanded (double
 * processing). Base64 has no `$` chars so it survives untouched.
 *
 * Set the B64 var via:
 *   echo -n '$2b$10$...' | base64
 */
export function getAdminPasswordHash(): string | undefined {
  const b64 = process.env.ADMIN_PASSWORD_HASH_B64;
  if (b64) {
    try {
      return Buffer.from(b64, "base64").toString("utf8");
    } catch {
      return undefined;
    }
  }
  return process.env.ADMIN_PASSWORD_HASH;
}

export async function requireAdmin(): Promise<void> {
  const hash = getAdminPasswordHash();
  if (!hash) throw new Error("ADMIN_PASSWORD_HASH(_B64) is not configured");

  const hs = await headers();
  const auth = hs.get("authorization");
  const creds = parseBasicAuth(auth);
  if (!creds || !constantTimeEq(creds.user, ADMIN_USER)) throw new UnauthorizedError();
  if (!(await bcrypt.compare(creds.password, hash))) throw new UnauthorizedError();
}
