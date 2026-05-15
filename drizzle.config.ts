import { defineConfig } from "drizzle-kit";
import path from "node:path";

const DB_PATH =
  process.env.DATABASE_URL ?? path.resolve("data/db/line-of-bugs.db");

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: DB_PATH },
  verbose: true,
  strict: true,
});
