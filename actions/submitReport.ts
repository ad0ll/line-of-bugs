"use server";

import { db } from "@/db";
import { images, reports } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { invalidateOnReportSubmit } from "./_invalidation";
import { REPORT_CATEGORIES, type SubmitReportArgs } from "@/lib/report-categories";

const MESSAGE_MAX = 250;
// Single-process token bucket: enough to throttle naive automated reporting
// without standing up Redis. Keyed by client IP (x-forwarded-for first hop,
// falling back to direct remote-addr). Resets on process restart, which is
// fine — the partial unique index in 0006_reports_dedup catches duplicate
// open reports regardless.
const RATE_LIMIT_MS = 10_000;
const recentSubmits = new Map<string, number>();

function clientIp(headerMap: Headers): string {
  const xff = headerMap.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headerMap.get("x-real-ip") ?? "unknown";
}

function pruneRateLimit(now: number): void {
  // Bound memory: drop entries past their window. Cheap because the map is
  // O(active submitters in the last 10s).
  for (const [ip, ts] of recentSubmits) {
    if (now - ts > RATE_LIMIT_MS) recentSubmits.delete(ip);
  }
}

export async function submitReport(args: SubmitReportArgs): Promise<void> {
  if (!REPORT_CATEGORIES.includes(args.category)) {
    throw new Error(`invalid category: ${args.category}`);
  }

  const hs = await headers();
  const ip = clientIp(hs);
  const now = Date.now();
  pruneRateLimit(now);
  const last = recentSubmits.get(ip);
  if (last !== undefined && now - last < RATE_LIMIT_MS) {
    throw new Error("rate limit exceeded — please wait a moment before reporting again");
  }
  recentSubmits.set(ip, now);

  const existing = db.select().from(images).where(eq(images.imageId, args.imageId)).all();
  if (existing.length === 0) {
    throw new Error(`unknown image_id: ${args.imageId}`);
  }

  let message: string | null = null;
  if (args.category === "other" && args.message) {
    message = args.message.slice(0, MESSAGE_MAX);
  }

  try {
    db.insert(reports).values({
      imageId: args.imageId,
      category: args.category,
      message,
    }).run();
  } catch (err) {
    // idx_reports_dedup_open enforces a partial unique on
    // (image_id, category) WHERE resolved_at IS NULL. better-sqlite3 surfaces
    // this as SqliteError with code SQLITE_CONSTRAINT_UNIQUE. Treat as a
    // benign no-op — the original report is already in the admin queue.
    const e = err as { code?: string; message?: string };
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE" ||
        (e.message ?? "").includes("UNIQUE constraint failed: idx_reports_dedup_open")) {
      return;
    }
    throw err;
  }

  invalidateOnReportSubmit();
}
