import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import path from "node:path";

// Two test tiers:
//   - node:    pure logic, DB queries, route handlers — fastest, no DOM
//   - browser: real chromium via @vitest/browser-playwright — DOM behaviour
//              that happy-dom can't fake faithfully (<dialog>, focus, layout,
//              real keyboard events, AudioContext)
//
// Coverage must live at root level — vitest 4 merges traces across
// projects automatically.
export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["app/**", "lib/**", "actions/**", "db/**"],
      exclude: [
        "**/*.d.ts",
        "**/*.test.*",
        "**/_components/**/index.ts",
        "scripts/**",
        "drizzle/**",
        "app/api/healthz/**",
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          setupFiles: ["./tests/setup-node.ts"],
          include: [
            "tests/api/**/*.test.ts",
            "tests/lib/facets.test.ts",
            "tests/lib/filter-clauses.test.ts",
            "tests/lib/fts-query.test.ts",
            "tests/lib/order-colors.test.ts",
            "tests/lib/repeat-mode.test.ts",
            "tests/lib/session-pools.test.ts",
            "tests/lib/subject.test.ts",
            "tests/lib/text-format.test.ts",
            "tests/lib/tokens.test.ts",
          ],
          env: { DATABASE_URL: ":memory:" },
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          setupFiles: ["./tests/setup-browser.ts"],
          include: [
            "tests/components/**/*.test.tsx",
            "tests/lib/audio.test.ts",
            "tests/lib/preload-manager.test.ts",
            "tests/lib/useHighResTimer.test.ts",
          ],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
            headless: true,
          },
        },
        resolve: {
          // next/image's CJS entrypoint reads `process.env` at load time and
          // crashes in the browser harness. Swap it for a plain <img> stub.
          alias: {
            "next/image": path.resolve(__dirname, "tests/stubs/next-image.tsx"),
          },
        },
      },
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
