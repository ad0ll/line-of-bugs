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

export async function requireAdmin(): Promise<void> {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) throw new Error("ADMIN_PASSWORD_HASH is not configured");

  const hs = await headers();
  const auth = hs.get("authorization");
  const creds = parseBasicAuth(auth);
  if (!creds || !constantTimeEq(creds.user, ADMIN_USER)) throw new UnauthorizedError();
  if (!(await bcrypt.compare(creds.password, hash))) throw new UnauthorizedError();
}
