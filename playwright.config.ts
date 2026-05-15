import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 2 workers is the sweet spot. Higher serializes behind the
  // better-sqlite3 sync handle that backs /api/session/start +
  // /api/facets, causing the session-player + gallery specs to time
  // out on the 500-row pool fetch. 4 workers regresses report-modal
  // flake-fail at 30 s; 2 workers passes 100 %.
  workers: process.env.CI ? 1 : 2,
  reporter: "list",
  // Default 30 s per test. The gallery + session-start specs need ~12 s
  // on a warm dev server and more on a cold start, so a tighter cap
  // (tried 15 s) regresses 3 tests; 30 s is the practical floor.
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Skip starting the local dev server when an external base URL is set
  // (e.g. when running the suite against the live deploy).
  //
  // Local default: `npm run dev` for HMR + reuseExistingServer so the
  // server stays warm across runs. For the cold-start case (CI, fresh
  // VM), set PLAYWRIGHT_PROD=1 to run against `npm run build && npm
  // run start` instead — slower first run but predictable cache state.
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: process.env.PLAYWRIGHT_PROD ? "npm run build && npm run start" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: process.env.PLAYWRIGHT_PROD ? 180_000 : 60_000,
  },
});
