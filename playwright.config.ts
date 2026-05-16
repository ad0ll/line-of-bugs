import { defineConfig, devices } from "@playwright/test";

// Opt-in cross-browser projects. Playwright runs every listed project
// by default, so to keep bare `npx playwright test` chromium-only for
// fast local iteration we only register firefox/webkit when one of:
//   - env CROSS_BROWSER=1 (CI cross-browser stage, both browsers)
//   - argv mentions the project explicitly
//     (`--project=firefox`, `--project=webkit`, `--project=all`)
//
// We have to promote argv hits into env vars here in the parent
// process: Playwright re-imports this config in each worker subprocess
// (which only inherit env, not argv), so an argv-only check would
// drop the project from the worker's view of the config and the run
// would fail with `Project "firefox" not found in the worker
// process.` Setting the env var here makes the gate worker-safe.
const argv = process.argv.join(" ");
if (/--project[= ](firefox|all)/.test(argv)) {
  process.env.CROSS_BROWSER_FIREFOX = "1";
}
if (/--project[= ](webkit|all)/.test(argv)) {
  process.env.CROSS_BROWSER_WEBKIT = "1";
}
const wantsFirefox =
  process.env.CROSS_BROWSER === "1" ||
  process.env.CROSS_BROWSER_FIREFOX === "1";
const wantsWebkit =
  process.env.CROSS_BROWSER === "1" ||
  process.env.CROSS_BROWSER_WEBKIT === "1";

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
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // Local + CI suite. Prod-smoke specs are gated to the `prod`
      // project so they don't run against localhost — they hit the
      // live deploy and would otherwise corrupt local data.
      testIgnore: /prod-smoke\.spec\.ts/,
    },
    // Firefox + webkit are opt-in (see `wantsFirefox` / `wantsWebkit`
    // at the top of this file). Bare `npx playwright test` only runs
    // chromium; cross-browser triage uses `--project=firefox`,
    // `--project=webkit`, or `CROSS_BROWSER=1`. Tests that are
    // chromium-only flag themselves with `test.skip(browserName === …)`
    // per-test rather than excluding whole spec files here.
    ...(wantsFirefox
      ? [
          {
            name: "firefox",
            use: { ...devices["Desktop Firefox"] },
            testIgnore: /prod-smoke\.spec\.ts/,
          },
        ]
      : []),
    ...(wantsWebkit
      ? [
          {
            name: "webkit",
            use: { ...devices["Desktop Safari"] },
            testIgnore: /prod-smoke\.spec\.ts/,
          },
        ]
      : []),
    {
      // Only runs when PROD_SMOKE=1 is set in the env. Targets the
      // live deploy via the baseURL inside prod-smoke.spec.ts. CI
      // should invoke `PROD_SMOKE=1 npx playwright test --project=prod`
      // explicitly; the default `npm run test:e2e` skips this project.
      name: "prod",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /prod-smoke\.spec\.ts/,
    },
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
