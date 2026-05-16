/**
 * Single source of truth for the SQLite file location.
 *
 * Used by both the runtime client (`db/index.ts`) and the drizzle-kit CLI
 * config (`drizzle.config.ts`) so a `DATABASE_URL` override applies
 * consistently to app reads/writes and to `drizzle-kit push|generate`.
 *
 * Default is repo-relative `data/db/line-of-bugs.db`, resolved against the
 * current working directory at import time.
 */
import path from "node:path";

export const DB_PATH =
  process.env.DATABASE_URL ?? path.resolve("data/db/line-of-bugs.db");
