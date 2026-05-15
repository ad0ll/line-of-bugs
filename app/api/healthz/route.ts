import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function GET() {
  try {
    const row = db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM images`);
    return Response.json({ ok: true, images: row?.c ?? 0, ts: new Date().toISOString() });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
