import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/e2e/**", "node_modules", ".next"],
    globals: true,
    // Must be set before db/index.ts loads. ES-module import hoisting
    // would otherwise pull setup.ts's imports above an in-file
    // assignment to process.env, binding the db singleton to the
    // real production file. vitest applies `env` before any module
    // evaluates.
    env: { DATABASE_URL: ":memory:" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
