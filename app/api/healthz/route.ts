import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function GET() {
  try {
    const row = db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM images`);
    return Response.json({ ok: true, images: row?.c ?? 0, ts: new Date().toISOString() });
  } catch (err) {
    // Log the underlying error for ops, but never leak DB text to clients.
    console.error("healthz:", err);
    return Response.json({ ok: false }, { status: 503 });
  }
}
