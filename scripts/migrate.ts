/**
 * Run drizzle migrations against the configured SQLite DB.
 *
 * Uses drizzle-orm's runtime migrator instead of `drizzle-kit migrate` because
 * the CLI silently swallows SQL errors and exits 0 even when migrations fail
 * (verified against drizzle-kit 0.31.10 with a deliberately broken migration).
 * The runtime migrator throws on the first failure so we see exactly which
 * statement broke.
 *
 * Honour DATABASE_URL the same way the rest of the app does (lib/db-path.ts),
 * so this works for prod, dev, and ephemeral test DBs (e.g. /tmp/...).
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DB_PATH } from "../lib/db-path";

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const db = drizzle(sqlite);

try {
  console.log(`Applying migrations to ${DB_PATH}\u2026`);
  migrate(db, { migrationsFolder: "drizzle" });
  console.log("\u2713 migrations applied successfully");
} catch (err) {
  console.error("\u2717 migration failed:");
  console.error(err instanceof Error ? err.message : err);
  if (err instanceof Error && err.cause) console.error("cause:", err.cause);
  process.exit(1);
} finally {
  sqlite.close();
}
