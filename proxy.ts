// proxy.ts (project root) — runs on the Node runtime (default in Next 16)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { parseBasicAuth } from "./lib/auth";

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

const ADMIN_USER = "admin";

function unauthorized() {
  return new NextResponse("auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="line-of-bugs admin"' },
  });
}

export function proxy(req: NextRequest): NextResponse {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  const auth = req.headers.get("authorization");
  console.log("[proxy] path=", req.nextUrl.pathname, "hash.len=", hash?.length, "auth.present=", !!auth);
  if (!hash) {
    console.log("[proxy] no hash in env");
    return unauthorized();
  }
  const creds = parseBasicAuth(auth);
  if (!creds || creds.user !== ADMIN_USER) {
    console.log("[proxy] no creds or user mismatch", { user: creds?.user });
    return unauthorized();
  }
  let ok = false;
  try {
    ok = bcrypt.compareSync(creds.password, hash);
  } catch (e) {
    console.log("[proxy] bcrypt threw", String(e));
  }
  console.log("[proxy] bcrypt ok=", ok);
  if (!ok) return unauthorized();
  return NextResponse.next();
}
