import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 4,
  reporter: "list",
  timeout: 15_000,
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
