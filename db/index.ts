/**
 * SQLite connection singleton.  Imported by app code, server functions /
 * route handlers, and the seed/migration scripts.
 *
 * Pragmas:
 *   - WAL journaling: concurrent reads during writes
 *   - synchronous = NORMAL: good fsync trade-off for read-mostly workloads
 *   - foreign_keys ON: cascade-delete on reports
 *   - busy_timeout 5000: small grace for the rare WAL-checkpoint contention
 *
 * Hot-reload safety:
 *   In Next.js dev, edits re-evaluate the module graph and can re-run
 *   `new Database(...)`, leaking file handles over a long session. We cache
 *   the underlying handle on `globalThis` — same trick Prisma's own example
 *   recommends. Production benefits too: re-imports during HMR-like
 *   route compilation (and any future double-evaluation) reuse the handle
 *   instead of opening another file descriptor.
 *
 * Drizzle init form is the object-config form recommended by the current
 * drizzle-orm/better-sqlite3 docs (https://orm.drizzle.team/docs/connect-better-sqlite3).
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import { DB_PATH } from "../lib/db-path";
import * as schema from "./schema";

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

type GlobalWithSqlite = typeof globalThis & {
  __lineOfBugsSqlite?: Database.Database;
};
const g = globalThis as GlobalWithSqlite;

function makeSqlite(): Database.Database {
  const conn = new Database(DB_PATH);
  conn.pragma("journal_mode = WAL");
  conn.pragma("synchronous = NORMAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("busy_timeout = 5000");
  return conn;
}

const sqlite = g.__lineOfBugsSqlite ?? makeSqlite();
g.__lineOfBugsSqlite = sqlite;

export const db = drizzle({ client: sqlite, schema });
export { schema };
export { sqlite };
export type DB = typeof db;
