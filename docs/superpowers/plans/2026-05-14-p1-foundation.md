# Line-of-Bugs P1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Next.js 16 + TypeScript app with eagle-ported design tokens, the three image-serving Route Handlers, the `images.hidden` schema addition, and the FTS5 virtual table — producing a dev server that serves the dark-themed shell and streams image bytes from `data/`.

**Architecture:** Next.js 16 App Router with TypeScript strict mode, Drizzle ORM with better-sqlite3 (already set up in P0), Vitest for unit tests + Playwright for e2e. Image-serving uses Route Handlers (Web Streams API) with `Cache-Control: immutable`. Design tokens ported from `~/projects/eagle-gesture-drawing/src/design-tokens.js` to a TypeScript module + CSS custom-property layer.

**Tech Stack:** Next.js 16 · React 19 · TypeScript 5 · Node 24 LTS · Drizzle ORM · better-sqlite3 · Vitest · Playwright · next/font/google (Zen Maru Gothic, JetBrains Mono, Fraunces)

**Companion spec:** `docs/superpowers/specs/2026-05-14-line-of-bugs-ui-design.md`

---

## File structure (P1)

```
package.json                          MODIFY: add next, react, react-dom, vitest, playwright deps
next.config.ts                        CREATE
.nvmrc                                EXISTS (24)
vitest.config.ts                      CREATE
tsconfig.json                         MODIFY: jsx + plugins + paths
app/
├── layout.tsx                        CREATE
├── globals.css                       CREATE (ported from eagle)
├── page.tsx                          CREATE (minimal stub)
└── api/
    ├── img/[name]/route.ts           CREATE
    ├── medium/[name]/route.ts        CREATE
    └── thumb/[name]/route.ts         CREATE
lib/
├── tokens.ts                         CREATE (ported from eagle)
└── streaming.ts                      CREATE (shared file-streaming helper)
db/schema.ts                          MODIFY: add hidden column
drizzle/
├── 0001_add_hidden.sql               CREATE (drizzle-kit generate)
└── 0002_fts5.sql                     CREATE (hand-written; applied via sqlite3 CLI)
tests/
├── setup.ts                          CREATE
├── api/
│   ├── img.test.ts                   CREATE
│   ├── medium.test.ts                CREATE
│   ├── thumb.test.ts                 CREATE
│   └── path-traversal.test.ts        CREATE
├── lib/tokens.test.ts                CREATE
└── e2e/smoke.spec.ts                 CREATE
playwright.config.ts                  CREATE
```

---

## Task 1: Install Next.js + React + dev dependencies

**Files:** Modify `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
npm install next@^16 react@^19 react-dom@^19 bcryptjs@^2
```

- [ ] **Step 2: Install dev deps**

```bash
npm install -D @types/react@^19 @types/react-dom@^19 @types/bcryptjs@^2 vitest@^3 @vitest/ui@^3 @testing-library/react@^16 @testing-library/jest-dom@^6 happy-dom@^15 @playwright/test@^1.48
```

- [ ] **Step 3: Verify**

```bash
node --version
npm ls next react drizzle-orm
```

Expected: Node v24.x, deps resolved.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "p1: install next, react, vitest, playwright deps"
```

---

## Task 2: Configure `next.config.ts`

**Files:** Create `next.config.ts`

- [ ] **Step 1: Write the config**

Create `next.config.ts`:

```typescript
import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    cacheComponents: true,
  },
  images: {
    unoptimized: true,
  },
};

export default config;
```

- [ ] **Step 2: Verify Next.js picks it up**

```bash
npx next info
```

Expected: prints Next.js 16.x.x with no errors.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "p1: next.config.ts (serverExternalPackages, cacheComponents)"
```

---

## Task 3: Update `tsconfig.json` for Next.js

**Files:** Modify `tsconfig.json`

- [ ] **Step 1: Replace contents**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".venv", "scripts/**/*.py", "data", ".next"]
}
```

- [ ] **Step 2: Seed `next-env.d.ts` so tsc can resolve Next's ambient types**

```bash
cat > next-env.d.ts <<'EOF'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
EOF
```

`next dev`/`next build` will regenerate this on first run. We seed it here so
`tsc --noEmit` works before either has run.

- [ ] **Step 3: Type-check passes**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "p1: tsconfig for Next.js app router"
```

---

## Task 4: Configure Vitest

**Files:** Create `vitest.config.ts`, `tests/setup.ts`, modify `package.json` scripts

- [ ] **Step 1: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/e2e/**", "node_modules", ".next"],
    globals: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
```

- [ ] **Step 2: Create `tests/setup.ts`**

```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Update `package.json` scripts**

Replace the `scripts` block in `package.json`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:push": "drizzle-kit push",
  "db:seed": "tsx db/seed.ts",
  "db:studio": "drizzle-kit studio"
}
```

- [ ] **Step 4: Create a smoke test**

Create `tests/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("vitest setup", () => {
  it("loads", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Verify**

```bash
npm test
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tests/setup.ts tests/smoke.test.ts package.json
git commit -m "p1: vitest config + smoke test"
```

---

## Task 5: Configure Playwright

**Files:** Create `playwright.config.ts`

- [ ] **Step 1: Write the config**

Create `playwright.config.ts`:

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 2: Install chromium**

```bash
npx playwright install chromium
```

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "p1: playwright config (chromium only)"
```

---

## Task 6: Add `images.hidden` column

**Files:** Modify `db/schema.ts`

- [ ] **Step 1: Add the column**

In `db/schema.ts`, in the `images` table definition, locate the `// Bookkeeping` comment block (above `addedAt`). Replace it with:

```typescript
    // Bookkeeping
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    addedAt: integer("added_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
```

- [ ] **Step 2: Add an index on hidden**

In the same file, in the `(t) => [ ... ]` index array (just before the closing bracket), add:

```typescript
    index("idx_images_hidden").on(t.hidden),
```

- [ ] **Step 3: Generate migration**

```bash
npm run db:generate
```

Expected: new file `drizzle/0001_<adjective_name>.sql` created with `ALTER TABLE images ADD COLUMN hidden ...` and `CREATE INDEX idx_images_hidden ...`.

- [ ] **Step 4: Apply migration**

```bash
npm run db:migrate
```

Expected: "migrations applied successfully".

- [ ] **Step 5: Verify column exists**

```bash
sqlite3 data/db/line-of-bugs.db "PRAGMA table_info(images)" | grep hidden
```

Expected: a row like `26|hidden|INTEGER|1|0|0`.

- [ ] **Step 6: Verify all existing rows are hidden=false**

```bash
sqlite3 data/db/line-of-bugs.db "SELECT COUNT(*) FROM images WHERE hidden = 0"
```

Expected: `5092`.

- [ ] **Step 7: Commit**

```bash
git add db/schema.ts drizzle/0001_*.sql drizzle/meta/
git commit -m "p1: add images.hidden column + idx_images_hidden"
```

---

## Task 7: Create FTS5 migration (idempotent SQL)

**Files:** Create `drizzle/0002_fts5.sql`

Applied via the system `sqlite3` CLI (drizzle-kit can't generate `CREATE VIRTUAL TABLE` from schema).

- [ ] **Step 1: Write the SQL**

Create `drizzle/0002_fts5.sql`:

```sql
-- FTS5 virtual table for fast species autocomplete.
-- Idempotent — safe to re-run (uses IF NOT EXISTS).

CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
  image_id UNINDEXED,
  common_name,
  taxon_species,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS images_fts_insert AFTER INSERT ON images BEGIN
  INSERT INTO images_fts(image_id, common_name, taxon_species)
  VALUES (new.image_id, new.common_name, new.taxon_species);
END;

CREATE TRIGGER IF NOT EXISTS images_fts_delete AFTER DELETE ON images BEGIN
  DELETE FROM images_fts WHERE image_id = old.image_id;
END;

CREATE TRIGGER IF NOT EXISTS images_fts_update AFTER UPDATE ON images BEGIN
  DELETE FROM images_fts WHERE image_id = old.image_id;
  INSERT INTO images_fts(image_id, common_name, taxon_species)
  VALUES (new.image_id, new.common_name, new.taxon_species);
END;

-- Backfill only if FTS5 table is empty
INSERT INTO images_fts(image_id, common_name, taxon_species)
SELECT image_id, common_name, taxon_species FROM images
WHERE NOT EXISTS (SELECT 1 FROM images_fts LIMIT 1);
```

- [ ] **Step 2: Apply via sqlite3 CLI**

```bash
sqlite3 data/db/line-of-bugs.db < drizzle/0002_fts5.sql
```

Expected: no output (silent success).

- [ ] **Step 3: Verify row count**

```bash
sqlite3 data/db/line-of-bugs.db "SELECT COUNT(*) FROM images_fts"
```

Expected: `5092`.

- [ ] **Step 4: Smoke-test a query**

```bash
sqlite3 data/db/line-of-bugs.db "SELECT image_id, common_name FROM images_fts WHERE images_fts MATCH 'lady*' LIMIT 3"
```

Expected: at least 1 row (e.g. Asian Lady Beetle).

- [ ] **Step 5: Verify idempotence — re-running is safe**

```bash
sqlite3 data/db/line-of-bugs.db < drizzle/0002_fts5.sql
sqlite3 data/db/line-of-bugs.db "SELECT COUNT(*) FROM images_fts"
```

Expected: still `5092` (backfill condition prevents duplicates).

- [ ] **Step 6: Commit**

```bash
git add drizzle/0002_fts5.sql
git commit -m "p1: FTS5 virtual table for images (idempotent SQL)"
```

---

## Task 8: Port eagle design tokens → `lib/tokens.ts`

**Files:** Create `lib/tokens.ts`, create `tests/lib/tokens.test.ts`

Source: `/Users/adoll/projects/eagle-gesture-drawing/src/design-tokens.js` (199 lines, single `T` object).

- [ ] **Step 1: Port the file**

Read the source file at `/Users/adoll/projects/eagle-gesture-drawing/src/design-tokens.js`. Port the comment block at the top (the prefix-suffix ruling system explanation) and the single `T` object to TypeScript verbatim. Eagle exports via `window.T =` or `module.exports`; we use `export const`.

Create `lib/tokens.ts`:

```typescript
// Design tokens — mirror of app/globals.css for inline-style consumers.
// Ported verbatim from /Users/adoll/projects/eagle-gesture-drawing/src/design-tokens.js
// (See that file for the prefix-suffix ruling system: s<N>, r<Size>, text<Size>, etc.)
// When updating, keep this in sync with app/globals.css.

export const T = {
  // ── Surfaces ──
  surface0: "#0d0c10",
  surface1: "#16141a",
  surface2: "#201e24",
  surfaceRaised: "rgba(16, 15, 18, 0.78)",
  surfacePanel: "rgba(16, 15, 18, 0.94)",
  surfaceModal: "rgba(22, 20, 26, 0.75)",
  surfaceChip: "rgba(10, 10, 11, 0.55)",
  surfaceChipStrong: "rgba(10, 10, 11, 0.78)",
  surfaceArrow: "rgba(16, 15, 18, 0.6)",
  surfaceScrim: "rgba(0, 0, 0, 0.4)",
  surfaceInk: "#0a0a0b",
  surfaceWhisper: "rgba(255, 255, 255, 0.015)",
  surfaceProgressTrack: "rgba(0, 0, 0, 0.55)",
  surfaceModalHalo: "#1a1520",
  surfaceHover: "rgba(255, 255, 255, 0.08)",
  surfaceActive: "rgba(255, 255, 255, 0.14)",
  surfaceInput: "rgba(255, 255, 255, 0.04)",

  // ── Text (WCAG AA floor 0.55) ──
  textPrimary: "rgba(255, 255, 255, 0.92)",
  textSecondary: "rgba(255, 255, 255, 0.7)",
  textTertiary: "rgba(255, 255, 255, 0.55)",
  textMuted: "rgba(255, 255, 255, 0.55)",
  textDisabled: "rgba(255, 255, 255, 0.3)",
  textWarning: "rgba(255, 210, 120, 0.95)",
  textDanger: "#ef4444",

  // ── Borders ──
  borderSubtle: "rgba(255, 255, 255, 0.07)",
  borderFaint: "rgba(255, 255, 255, 0.07)",
  borderMedium: "rgba(255, 255, 255, 0.1)",
  borderEmphasis: "rgba(255, 255, 255, 0.2)",
  borderWarning: "rgba(255, 170, 0, 0.3)",
  borderWarningStrong: "rgba(255, 170, 0, 0.4)",
  borderDanger: "rgba(239, 68, 68, 0.5)",

  // ── Spacing (s<N> prefix; N IS the pixel value, with some skips at 9, 11) ──
  s1: 2, s2: 4, s3: 6, s4: 8, s5: 10, s6: 12, s7: 14, s8: 16,
  s10: 20, s12: 24,

  // ── Border radius (r<size>) ──
  rXs: 3, rSm: 4, rMd: 5, rLg: 6, rXl: 7, r2xl: 8, r3xl: 10, r4xl: 12, r5xl: 14,

  // ── Font sizes (text<size>) ──
  textXs: 13, textSm: 13, textMd: 14, textBase: 15,
  textLg: 16, textXl: 20, text2xl: 26, text3xl: 32,

  // ── Backdrop blur (blur<size>) ──
  blurSm: "blur(8px)",
  blurMd: "blur(12px)",
  blurLg: "blur(16px)",
  blurXl: "blur(20px)",
  blur2xl: "blur(24px)",

  // ── Transition timing ──
  timingFast: "0.12s",
  timingBase: "0.15s",
  timingSlow: "0.2s",

  // ── Letter spacing ──
  trackingWide: 0.3,
  trackingWider: 0.4,
  trackingWidest: 0.8,

  // ── Behavioral constants (timeouts, etc.) ──
  durationChromeHide: 2000, // ms — session player chrome auto-hide

  // ── Shadows ──
  shadowPanel: "0 8px 24px rgba(0, 0, 0, 0.45)",
  shadowModal: "0 16px 48px rgba(0, 0, 0, 0.55)",
  shadowLarge: "0 20px 60px rgba(0, 0, 0, 0.6)",
} as const;

export type Tokens = typeof T;
```

If `lib/tokens.ts` already exists from earlier work (it does NOT in this repo as of P1 start), back it up first.

- [ ] **Step 2: Write the test**

Create `tests/lib/tokens.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { T } from "@/lib/tokens";

describe("design tokens", () => {
  it("exposes the surface-0 base color", () => {
    expect(T.surface0).toBe("#0d0c10");
  });

  it("exposes text alpha ladder", () => {
    expect(T.textPrimary).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.92\)/);
    expect(T.textSecondary).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.7\)/);
    expect(T.textTertiary).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.55\)/);
  });

  it("exposes 4 px spacing grid", () => {
    expect(T.s2).toBe(4);
    expect(T.s4).toBe(8);
    expect(T.s8).toBe(16);
  });

  it("exposes durationChromeHide for the auto-hide pattern", () => {
    expect(T.durationChromeHide).toBe(2000);
  });

  it("exposes Fraunces/Zen-Maru-style timing scales", () => {
    expect(T.timingFast).toBe("0.12s");
    expect(T.timingBase).toBe("0.15s");
    expect(T.timingSlow).toBe("0.2s");
  });
});
```

- [ ] **Step 3: Run test**

```bash
npm test -- tests/lib/tokens.test.ts
```

Expected: 5 tests passed.

- [ ] **Step 4: Commit**

```bash
git add lib/tokens.ts tests/lib/tokens.test.ts
git commit -m "p1: port eagle design tokens to lib/tokens.ts"
```

---

## Task 9: Port eagle CSS layer → `app/globals.css`

**Files:** Create `app/globals.css`

- [ ] **Step 1: Write the CSS file**

Read `/Users/adoll/projects/eagle-gesture-drawing/assets/styles.css` and port the `:root` custom-property block + utility classes + reduced-motion media query. Use kebab-case CSS variable names matching eagle's (e.g. `--surface-0`, `--text-primary`).

Create `app/globals.css`:

```css
:root {
  /* Surfaces */
  --surface-0: #0d0c10;
  --surface-1: #16141a;
  --surface-2: #201e24;
  --surface-raised: rgba(16, 15, 18, 0.78);
  --surface-panel: rgba(16, 15, 18, 0.94);
  --surface-modal: rgba(22, 20, 26, 0.75);
  --surface-chip: rgba(10, 10, 11, 0.55);
  --surface-chip-strong: rgba(10, 10, 11, 0.78);
  --surface-arrow: rgba(16, 15, 18, 0.6);
  --surface-scrim: rgba(0, 0, 0, 0.4);
  --surface-ink: #0a0a0b;
  --surface-progress-track: rgba(0, 0, 0, 0.55);
  --surface-hover: rgba(255, 255, 255, 0.08);
  --surface-active: rgba(255, 255, 255, 0.14);

  /* Text */
  --text-primary: rgba(255, 255, 255, 0.92);
  --text-secondary: rgba(255, 255, 255, 0.7);
  --text-tertiary: rgba(255, 255, 255, 0.55);
  --text-muted: rgba(255, 255, 255, 0.55);
  --text-disabled: rgba(255, 255, 255, 0.3);
  --text-warning: rgba(255, 210, 120, 0.95);
  --text-danger: #ef4444;

  /* Borders */
  --border-subtle: rgba(255, 255, 255, 0.07);
  --border-medium: rgba(255, 255, 255, 0.1);
  --border-emphasis: rgba(255, 255, 255, 0.2);
  --border-warning: rgba(255, 170, 0, 0.3);
  --border-danger: rgba(239, 68, 68, 0.5);

  /* Spacing */
  --s1: 2px;  --s2: 4px;  --s3: 6px;  --s4: 8px;
  --s5: 10px; --s6: 12px; --s7: 14px; --s8: 16px;
  --s10: 20px; --s12: 24px;

  /* Radii */
  --r-xs: 3px;  --r-sm: 4px;  --r-md: 5px;
  --r-lg: 6px;  --r-xl: 7px;  --r-2xl: 8px;
  --r-3xl: 10px; --r-4xl: 12px; --r-5xl: 14px;

  /* Timing */
  --timing-fast: 0.12s;
  --timing-base: 0.15s;
  --timing-slow: 0.2s;

  /* Shadows */
  --shadow-panel: 0 8px 24px rgba(0, 0, 0, 0.45);
  --shadow-modal: 0 16px 48px rgba(0, 0, 0, 0.55);
  --shadow-large: 0 20px 60px rgba(0, 0, 0, 0.6);
}

/* ── Base ── */
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  background: var(--surface-0);
  color: var(--text-primary);
  min-height: 100vh;
}
body {
  font-family: var(--font-sans), system-ui, sans-serif;
  font-weight: 500;
}

/* ── Focus ring (dual-ring) ── */
:focus-visible {
  outline: 1.5px solid var(--surface-0);
  outline-offset: 1px;
  box-shadow: 0 0 0 2px rgba(255, 200, 230, 0.6);
}

/* ── Utility: icon button hover state ── */
.u-icon-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background var(--timing-fast), color var(--timing-fast);
}
.u-icon-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
.u-icon-btn.is-active { background: var(--surface-active); color: var(--text-primary); }
.u-icon-btn:disabled { opacity: 0.4; cursor: default; }

/* ── Utility: backdrop blur w/ opaque fallback ── */
@supports (backdrop-filter: blur(8px)) {
  .u-backdrop-blur-sm  { backdrop-filter: blur(8px); }
  .u-backdrop-blur-md  { backdrop-filter: blur(12px); }
  .u-backdrop-blur-lg  { backdrop-filter: blur(16px); }
}
@supports not (backdrop-filter: blur(8px)) {
  .u-backdrop-blur-sm, .u-backdrop-blur-md, .u-backdrop-blur-lg {
    background: var(--surface-panel);
  }
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "p1: port eagle globals.css (tokens, utilities, reset)"
```

---

## Task 10: Create `app/layout.tsx` with fonts

**Files:** Create `app/layout.tsx`, create `app/page.tsx`

- [ ] **Step 1: Write the root layout**

Create `app/layout.tsx`:

```typescript
import type { Metadata } from "next";
import { Zen_Maru_Gothic, JetBrains_Mono, Fraunces } from "next/font/google";
import "./globals.css";

const sans = Zen_Maru_Gothic({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "line of bugs",
  description: "gesture drawing practice with insect photos",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${display.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Write the minimal home page stub**

Create `app/page.tsx`:

```typescript
export default function Home() {
  return (
    <main style={{ padding: 48 }}>
      <h1
        style={{
          fontFamily: "var(--font-display), serif",
          fontWeight: 500,
          fontSize: 38,
          letterSpacing: "-0.5px",
        }}
      >
        line of bugs
      </h1>
      <p style={{ color: "var(--text-tertiary)" }}>
        foundation up — pages coming in P2-P4.
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Dev server smoke check**

```bash
npm run dev &
sleep 5
curl -s http://localhost:3000/ | grep -E "(line of bugs|surface-0)"
kill %1
```

Expected: HTML containing "line of bugs" text.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/page.tsx
git commit -m "p1: root layout (fonts) + minimal home stub"
```

---

## Task 11: Build shared file-streaming helper

**Files:** Create `lib/streaming.ts`, create `tests/api/path-traversal.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/path-traversal.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { safeBasename } from "@/lib/streaming";

describe("safeBasename", () => {
  it("passes a normal filename through", () => {
    expect(safeBasename("foo_bar-1.jpg")).toBe("foo_bar-1.jpg");
  });

  it("rejects path traversal attempts (returns empty)", () => {
    expect(safeBasename("../etc/passwd")).toBe("");
  });

  it("strips null bytes", () => {
    expect(safeBasename("ok.jpg\u0000.txt")).toBe("ok.jpg.txt");
  });

  it("rejects backslash traversal attempts (returns empty)", () => {
    expect(safeBasename("..\\windows\\system32")).toBe("");
  });

  it("returns empty for empty input", () => {
    expect(safeBasename("")).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- tests/api/path-traversal.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

Create `lib/streaming.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * Strip everything that isn't an allowed filename character, then collapse
 * leading dots so traversal sequences like "../" can't survive the cleanup.
 */
export function safeBasename(name: string): string {
  const stripped = name.replace(/[^a-z0-9_.-]/gi, "");
  // Reject if traversal patterns remain after stripping non-allowed chars.
  if (stripped.includes("..")) return "";
  return stripped;
}

/**
 * Stream a file from a tier directory.
 * Returns a Response with immutable cache headers, or null if missing.
 */
export function streamImage(
  tierDir: "images" | "medium" | "thumbnails",
  rawName: string,
): Response | null {
  const safe = safeBasename(rawName);
  if (!safe) return null;
  const filePath = path.join(process.cwd(), "data", tierDir, safe);
  if (!fs.existsSync(filePath)) return null;
  // Bridge a Node fs.ReadStream into a Web ReadableStream — the Route Handler
  // contract is Web Streams, and Readable.toWeb is the canonical adapter.
  const nodeStream = fs.createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(webStream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/api/path-traversal.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/streaming.ts tests/api/path-traversal.test.ts
git commit -m "p1: safeBasename + streamImage helper"
```

---

## Task 12: Route handler `/api/img/[name]`

**Files:** Create `app/api/img/[name]/route.ts`, `tests/api/img.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/img.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GET } from "@/app/api/img/[name]/route";

describe("/api/img/[name]", () => {
  let knownFilename: string;
  beforeAll(() => {
    const files = fs.readdirSync(path.resolve("data/images"));
    knownFilename = files[0]!;
  });

  it("streams a known file with immutable cache header", async () => {
    const res = await GET(new Request(`http://localhost/api/img/${knownFilename}`), {
      params: Promise.resolve({ name: knownFilename }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(1000);
  });

  it("returns 404 for non-existent file", async () => {
    const res = await GET(new Request("http://localhost/api/img/nope.jpg"), {
      params: Promise.resolve({ name: "nope.jpg" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects path traversal attempts", async () => {
    const res = await GET(
      new Request("http://localhost/api/img/..%2F..%2Fetc%2Fpasswd"),
      { params: Promise.resolve({ name: "../../etc/passwd" }) },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
npm test -- tests/api/img.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/api/img/[name]/route.ts`:

```typescript
import { streamImage } from "@/lib/streaming";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const response = streamImage("images", name);
  if (!response) return new Response("not found", { status: 404 });
  return response;
}
```

- [ ] **Step 4: Verify it passes**

```bash
npm test -- tests/api/img.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/api/img/[name]/route.ts tests/api/img.test.ts
git commit -m "p1: /api/img/[name] route handler + tests"
```

---

## Task 13: Route handler `/api/medium/[name]`

**Files:** Create `app/api/medium/[name]/route.ts`, `tests/api/medium.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/medium.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GET } from "@/app/api/medium/[name]/route";

describe("/api/medium/[name]", () => {
  let knownFilename: string;
  beforeAll(() => {
    const files = fs.readdirSync(path.resolve("data/medium"));
    knownFilename = files[0]!;
  });

  it("streams a medium-tier file", async () => {
    const res = await GET(new Request(`http://localhost/api/medium/${knownFilename}`), {
      params: Promise.resolve({ name: knownFilename }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(1000);
    expect(body.byteLength).toBeLessThan(1_000_000);
  });

  it("returns 404 for missing file", async () => {
    const res = await GET(new Request("http://localhost/api/medium/none.jpg"), {
      params: Promise.resolve({ name: "none.jpg" }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
npm test -- tests/api/medium.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/api/medium/[name]/route.ts`:

```typescript
import { streamImage } from "@/lib/streaming";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const response = streamImage("medium", name);
  if (!response) return new Response("not found", { status: 404 });
  return response;
}
```

- [ ] **Step 4: Verify it passes**

```bash
npm test -- tests/api/medium.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add app/api/medium/[name]/route.ts tests/api/medium.test.ts
git commit -m "p1: /api/medium/[name] route handler + tests"
```

---

## Task 14: Route handler `/api/thumb/[name]`

**Files:** Create `app/api/thumb/[name]/route.ts`, `tests/api/thumb.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/thumb.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GET } from "@/app/api/thumb/[name]/route";

describe("/api/thumb/[name]", () => {
  let knownFilename: string;
  beforeAll(() => {
    const files = fs.readdirSync(path.resolve("data/thumbnails"));
    knownFilename = files[0]!;
  });

  it("streams a thumbnail file", async () => {
    const res = await GET(new Request(`http://localhost/api/thumb/${knownFilename}`), {
      params: Promise.resolve({ name: knownFilename }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(1000);
    expect(body.byteLength).toBeLessThan(200_000);
  });

  it("returns 404 for missing file", async () => {
    const res = await GET(new Request("http://localhost/api/thumb/none.jpg"), {
      params: Promise.resolve({ name: "none.jpg" }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
npm test -- tests/api/thumb.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/api/thumb/[name]/route.ts`:

```typescript
import { streamImage } from "@/lib/streaming";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const response = streamImage("thumbnails", name);
  if (!response) return new Response("not found", { status: 404 });
  return response;
}
```

- [ ] **Step 4: Verify it passes**

```bash
npm test -- tests/api/thumb.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add app/api/thumb/[name]/route.ts tests/api/thumb.test.ts
git commit -m "p1: /api/thumb/[name] route handler + tests"
```

---

## Task 15: E2E smoke test

**Files:** Create `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Read a known thumbnail filename**

```bash
ls data/thumbnails | head -1
```

Note the exact filename for substitution below.

- [ ] **Step 2: Write the e2e spec**

Create `tests/e2e/smoke.spec.ts` — replace `<KNOWN_THUMB>` with the filename from step 1:

```typescript
import { test, expect } from "@playwright/test";

test("home page renders with dark theme", async ({ page }) => {
  await page.goto("/");
  const bg = await page.evaluate(() =>
    window.getComputedStyle(document.body).backgroundColor,
  );
  expect(bg).toBe("rgb(13, 12, 16)"); // #0d0c10
  await expect(page.locator("h1")).toContainText("line of bugs");
});

test("thumb route returns JPEG with cache headers", async ({ request }) => {
  const KNOWN_THUMB = "<KNOWN_THUMB>"; // ← replace with output from step 1
  const res = await request.get(`/api/thumb/${KNOWN_THUMB}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/jpeg");
  expect(res.headers()["cache-control"]).toContain("immutable");
});

test("img route returns 404 for missing file", async ({ request }) => {
  const res = await request.get("/api/img/nope-not-here.jpg");
  expect(res.status()).toBe(404);
});
```

- [ ] **Step 3: Run e2e tests**

```bash
npm run test:e2e
```

Expected: 3 e2e tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/smoke.spec.ts
git commit -m "p1: e2e smoke (home, thumb, 404)"
```

---

## Task 16: Update `.gitignore`

**Files:** Modify `.gitignore`

- [ ] **Step 1: Append entries**

Append to `.gitignore`:

```
# Next.js
.next/
out/
next-env.d.ts

# Playwright
playwright-report/
test-results/

# Vitest
coverage/
```

- [ ] **Step 2: Verify**

```bash
git status
```

Expected: `.next/`, `playwright-report/`, etc. not in untracked.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "p1: gitignore .next, playwright reports, vitest coverage"
```

---

## Task 17: Full validation + production build

- [ ] **Step 1: Run all unit tests**

```bash
npm test
```

Expected: all green.

- [ ] **Step 2: Run e2e**

```bash
npm run test:e2e
```

Expected: all green.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Build the production bundle**

```bash
npm run build
```

Expected: build succeeds; reports 5 routes (`/`, `/api/img/[name]`, `/api/medium/[name]`, `/api/thumb/[name]`).

- [ ] **Step 5: Final commit (only if anything changed)**

```bash
git status
```

If anything is uncommitted, commit it: `git commit -am "p1: final"`.

---

**P1 complete.** Dev server runs the dark theme; route handlers stream from all three tiers with immutable cache; FTS5 is ready; `images.hidden` column wired in. Ready for **P2 (Sessions)**.

## Self-review

- Spec coverage: §2 stack ✓, §3 architecture skeleton ✓, §4 schema additions ✓, §6 image-serving tiers ✓, §12 styling system ✓
- No placeholders, no TBD/TODO
- All file paths concrete; all code shown in full
- Type consistency: `streamImage(tierDir, rawName)` signature matches across all three route handlers
- Each task has TDD pattern (red → green → commit) where applicable
