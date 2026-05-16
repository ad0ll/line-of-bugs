import { defineConfig } from "drizzle-kit";

import { DB_PATH } from "./lib/db-path";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: DB_PATH },
  verbose: true,
  strict: true,
});
