// proxy.ts (project root) — runs on the Node runtime (default in Next 16)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { ADMIN_USER, constantTimeEq, parseBasicAuth } from "./lib/auth";

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

function unauthorized() {
  return new NextResponse("auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="line-of-bugs admin"' },
  });
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) return unauthorized();
  const creds = parseBasicAuth(req.headers.get("authorization"));
  if (!creds || !constantTimeEq(creds.user, ADMIN_USER)) return unauthorized();
  if (!(await bcrypt.compare(creds.password, hash))) return unauthorized();
  return NextResponse.next();
}
