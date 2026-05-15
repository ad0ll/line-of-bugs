# Line-of-Bugs P4 (Moderation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the feedback loop. Students press `R` (or click the action-bar Report button) inside a session, see a modal over the player with 5 category chips, submit a report, and the image disappears from gallery/session pools immediately. Admins visit a hidden `/admin/reports` URL (gated by HTTP Basic Auth), see pending reports as cards, and resolve each by Dismiss / Hide / Delete. All admin actions invalidate the correct cache tags so the gallery + autocomplete reflect changes within the next render.

**Architecture:** Reports are submitted via a Server Function (`submitReport`) called from a client form inside a route-intercepted modal (`@modal/(.)report/[id]`). The modal uses Next.js parallel + intercepting routes so the URL is shareable/refresh-safe (full page at `/report/[id]`) but the in-session experience is overlay-style without losing player state. Admin protection is layered: `proxy.ts` (Next.js 16's renamed middleware) blocks unauthorized requests at the edge; each admin Server Function additionally calls `requireAdmin()` (re-reads the `Authorization` header from `next/headers` and bcrypt-compares) to defend against accidental skip. Cache invalidation is centralized in `actions/_invalidation.ts` so each mutation calls a single named function instead of spreading `revalidateTag` calls across files.

**Tech Stack:** Next.js 16 Server Functions (`'use server'`) · `next/headers` for auth re-verify · `bcryptjs` for password compare · `unstable_revalidateTag` (renamed from `revalidateTag` in Next 16) · Parallel + intercepting routes (`@modal/`, `(.)report/[id]`)

**Companion spec:** `docs/superpowers/specs/2026-05-14-line-of-bugs-ui-design.md` §10 (Report flow), §11 (Auth), §13 (Cache tags + invalidation)
**Prereq:** P1, P2, P3 complete. Gallery already enforces the visibility predicate, so the moment a report exists with `resolved_at IS NULL`, the image vanishes from the grid.

---

## File structure (P4)

```
proxy.ts                                            CREATE (Next.js 16 middleware rename)
lib/
├── auth.ts                                         CREATE (requireAdmin + parseBasicAuth)
└── queries/
    └── reports.ts                                  CREATE (getPendingReports, getPendingCount)
actions/
├── submitReport.ts                                 CREATE
├── dismissReport.ts                                CREATE
├── hideImage.ts                                    CREATE
├── deleteImage.ts                                  CREATE
└── _invalidation.ts                                CREATE (cache-tag bundles)
app/
├── report/
│   └── [id]/page.tsx                               CREATE (full-page; URL hit/refresh)
├── @modal/
│   ├── default.tsx                                 CREATE (null when slot inactive)
│   └── (.)report/
│       └── [id]/page.tsx                           CREATE (intercepting modal)
├── admin/
│   └── reports/page.tsx                            CREATE (Basic-Auth gated)
├── components/
│   ├── modal/Modal.tsx                             CREATE (frame for intercept route)
│   ├── report/
│   │   ├── ReportForm.tsx                          CREATE (5 chips + textarea)
│   │   └── ReportCategoryChips.tsx                 CREATE
│   └── admin/
│       ├── ReportCard.tsx                          CREATE
│       └── ConfirmDeleteButton.tsx                 CREATE (inline-morph button)
├── layout.tsx                                      MODIFY (add @modal slot)
└── api/admin/
    └── revalidate/route.ts                         (optional; not needed if Server Functions own invalidation)
public/robots.txt                                   CREATE (Disallow: /admin/)
tests/
├── lib/
│   ├── auth.test.ts                                CREATE
│   └── queries/
│       └── reports.test.ts                         CREATE
├── actions/
│   ├── submitReport.test.ts                        CREATE
│   ├── dismissReport.test.ts                       CREATE
│   ├── hideImage.test.ts                           CREATE
│   ├── deleteImage.test.ts                         CREATE
│   └── invalidation.test.ts                        CREATE
├── components/
│   ├── ReportForm.test.tsx                         CREATE
│   ├── ReportCategoryChips.test.tsx                CREATE
│   ├── Modal.test.tsx                              CREATE
│   ├── ReportCard.test.tsx                         CREATE
│   └── ConfirmDeleteButton.test.tsx                CREATE
└── e2e/
    ├── report-modal.spec.ts                        CREATE
    ├── admin-auth.spec.ts                          CREATE
    └── admin-resolve.spec.ts                       CREATE
```

---

## Task 1: Install bcryptjs types

**Files:** Modify `package.json`

Already installed runtime dep in P1 (per spec). Make sure types are present for `tsc --noEmit`.

- [ ] **Step 1: Install types**

```bash
npm install --save-dev @types/bcryptjs
```

- [ ] **Step 2: Verify**

```bash
node -e "console.log(require.resolve('bcryptjs'))"
```

Expected: prints a path under `node_modules/bcryptjs`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(p4): @types/bcryptjs"
```

---

## Task 2: Cache-tag invalidation bundles

**Files:** Create `actions/_invalidation.ts`, `tests/actions/invalidation.test.ts`

This is a single source of truth so each mutation lists exactly the tags it should invalidate. The names match the §13 table.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/actions/invalidation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

import { revalidateTag } from 'next/cache';
import {
  invalidateOnReportSubmit,
  invalidateOnDismiss,
  invalidateOnHide,
  invalidateOnDelete,
} from '@/actions/_invalidation';

describe('cache invalidation bundles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submit invalidates reports, gallery-results, images-stats', () => {
    invalidateOnReportSubmit();
    expect(revalidateTag).toHaveBeenCalledWith('reports', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('gallery-results', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('images-stats', 'max');
    expect(revalidateTag).not.toHaveBeenCalledWith('species-index', 'max');
  });

  it('dismiss invalidates reports + gallery-results only', () => {
    invalidateOnDismiss();
    expect(revalidateTag).toHaveBeenCalledWith('reports', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('gallery-results', 'max');
    expect(revalidateTag).not.toHaveBeenCalledWith('images-stats', 'max');
    expect(revalidateTag).not.toHaveBeenCalledWith('species-index', 'max');
  });

  it('hide invalidates reports, gallery-results, images-stats', () => {
    invalidateOnHide();
    expect(revalidateTag).toHaveBeenCalledWith('reports', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('gallery-results', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('images-stats', 'max');
    expect(revalidateTag).not.toHaveBeenCalledWith('species-index', 'max');
  });

  it('delete invalidates everything including species-index', () => {
    invalidateOnDelete();
    expect(revalidateTag).toHaveBeenCalledWith('reports', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('gallery-results', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('images-stats', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('species-index', 'max');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/invalidation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// actions/_invalidation.ts
import { revalidateTag } from 'next/cache';

export function invalidateOnReportSubmit(): void {
  revalidateTag('reports', 'max');
  revalidateTag('gallery-results', 'max');
  revalidateTag('images-stats', 'max');
}

export function invalidateOnDismiss(): void {
  revalidateTag('reports', 'max');
  revalidateTag('gallery-results', 'max');
}

export function invalidateOnHide(): void {
  revalidateTag('reports', 'max');
  revalidateTag('gallery-results', 'max');
  revalidateTag('images-stats', 'max');
}

export function invalidateOnDelete(): void {
  revalidateTag('reports', 'max');
  revalidateTag('gallery-results', 'max');
  revalidateTag('images-stats', 'max');
  revalidateTag('species-index', 'max');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/actions/invalidation.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add actions/_invalidation.ts tests/actions/invalidation.test.ts
git commit -m "feat(p4): cache-tag invalidation bundles"
```

---

## Task 3: Auth helper — parseBasicAuth

**Files:** Create `lib/auth.ts`, `tests/lib/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/auth.test.ts
import { describe, it, expect } from 'vitest';
import { parseBasicAuth } from '@/lib/auth';

describe('parseBasicAuth', () => {
  it('returns user + password for valid header', () => {
    const header = 'Basic ' + btoa('admin:hunter2');
    expect(parseBasicAuth(header)).toEqual({ user: 'admin', password: 'hunter2' });
  });

  it('returns null for null header', () => {
    expect(parseBasicAuth(null)).toBe(null);
  });

  it('returns null for wrong scheme', () => {
    expect(parseBasicAuth('Bearer abc')).toBe(null);
  });

  it('returns null for malformed base64', () => {
    expect(parseBasicAuth('Basic not-base64!!!')).toBe(null);
  });

  it('returns null when colon is missing', () => {
    const header = 'Basic ' + btoa('admin-no-colon');
    expect(parseBasicAuth(header)).toBe(null);
  });

  it('handles password containing a colon', () => {
    const header = 'Basic ' + btoa('admin:hun:ter:2');
    expect(parseBasicAuth(header)).toEqual({ user: 'admin', password: 'hun:ter:2' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement parseBasicAuth**

```typescript
// lib/auth.ts
export type BasicCreds = { user: string; password: string };

export function parseBasicAuth(header: string | null): BasicCreds | null {
  if (!header || !header.startsWith('Basic ')) return null;
  const encoded = header.slice(6);
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  const idx = decoded.indexOf(':');
  if (idx === -1) return null;
  return {
    user: decoded.slice(0, idx),
    password: decoded.slice(idx + 1),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/auth.test.ts`
Expected: PASS (6).

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts tests/lib/auth.test.ts
git commit -m "feat(p4): parseBasicAuth helper"
```

---

## Task 4: Auth helper — requireAdmin (Server-Function side)

**Files:** Modify `lib/auth.ts`, extend `tests/lib/auth.test.ts`

`requireAdmin()` re-reads the `Authorization` header inside Server Functions and bcrypt-compares to `ADMIN_PASSWORD_HASH`. Used by every admin mutation.

- [ ] **Step 1: Extend the test**

```typescript
// tests/lib/auth.test.ts — append
import { vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({
    get: (k: string) => (k.toLowerCase() === 'authorization' ? mockHeader : null),
  }),
}));

let mockHeader: string | null = null;

describe('requireAdmin', () => {
  let originalHash: string | undefined;
  beforeAll(async () => {
    originalHash = process.env.ADMIN_PASSWORD_HASH;
    const bcrypt = await import('bcryptjs');
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('hunter2', 10);
  });
  afterAll(() => {
    if (originalHash) process.env.ADMIN_PASSWORD_HASH = originalHash;
    else delete process.env.ADMIN_PASSWORD_HASH;
  });

  it('throws when header missing', async () => {
    const { requireAdmin } = await import('@/lib/auth');
    mockHeader = null;
    await expect(requireAdmin()).rejects.toThrow(/unauthorized/i);
  });

  it('throws when user mismatch', async () => {
    const { requireAdmin } = await import('@/lib/auth');
    mockHeader = 'Basic ' + btoa('root:hunter2');
    await expect(requireAdmin()).rejects.toThrow(/unauthorized/i);
  });

  it('throws when password wrong', async () => {
    const { requireAdmin } = await import('@/lib/auth');
    mockHeader = 'Basic ' + btoa('admin:wrong');
    await expect(requireAdmin()).rejects.toThrow(/unauthorized/i);
  });

  it('passes when credentials match', async () => {
    const { requireAdmin } = await import('@/lib/auth');
    mockHeader = 'Basic ' + btoa('admin:hunter2');
    await expect(requireAdmin()).resolves.not.toThrow();
  });

  it('throws if ADMIN_PASSWORD_HASH is unset', async () => {
    const { requireAdmin } = await import('@/lib/auth');
    const prev = process.env.ADMIN_PASSWORD_HASH;
    delete process.env.ADMIN_PASSWORD_HASH;
    mockHeader = 'Basic ' + btoa('admin:hunter2');
    await expect(requireAdmin()).rejects.toThrow();
    process.env.ADMIN_PASSWORD_HASH = prev;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/auth.test.ts`
Expected: 5 new tests fail.

- [ ] **Step 3: Implement requireAdmin**

```typescript
// lib/auth.ts — append
import bcrypt from 'bcryptjs';
import { headers } from 'next/headers';

const ADMIN_USER = 'admin';

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

export async function requireAdmin(): Promise<void> {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) throw new Error('ADMIN_PASSWORD_HASH is not configured');

  const hs = await headers();
  const auth = hs.get('authorization');
  const creds = parseBasicAuth(auth);
  if (!creds || creds.user !== ADMIN_USER) throw new UnauthorizedError();
  if (!bcrypt.compareSync(creds.password, hash)) throw new UnauthorizedError();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/auth.test.ts`
Expected: PASS (11 total).

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts tests/lib/auth.test.ts
git commit -m "feat(p4): requireAdmin Server-Function-side auth re-verify"
```

---

## Task 5: proxy.ts (Next.js 16 middleware rename)

**Files:** Create `proxy.ts` at project root

This is Next.js 16's `proxy.ts` (formerly `middleware.ts`). Runs before the route handler and short-circuits with 401 for unauthorized admin requests. **Runtime note:** `bcryptjs` is pure-JS so it works in any runtime, but `proxy` defaults to the Node runtime in Next 16 — that's what we want here (no `export const runtime = 'edge'`).

- [ ] **Step 1: Implement proxy.ts**

```typescript
// proxy.ts (project root) — runs on the Node runtime (default in Next 16)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { parseBasicAuth } from './lib/auth';

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

const ADMIN_USER = 'admin';

function unauthorized() {
  return new NextResponse('auth required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="line-of-bugs admin"' },
  });
}

export function proxy(req: NextRequest): NextResponse {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) return unauthorized();
  const creds = parseBasicAuth(req.headers.get('authorization'));
  if (!creds || creds.user !== ADMIN_USER) return unauthorized();
  if (!bcrypt.compareSync(creds.password, hash)) return unauthorized();
  return NextResponse.next();
}
```

> **Note:** Next.js 16 supports both `middleware` (deprecated) and `proxy` exports. We use `proxy`. Verify the runtime accepts the file shape by booting the dev server.

- [ ] **Step 2: Set up env for local dev**

Add to `.env.local` (gitignored):

```bash
# Run this once at the shell — produces a fresh hash for the local dev password
node -e "console.log(require('bcryptjs').hashSync('dev-pass', 10))"
```

Take the printed hash and paste into `.env.local`:

```
ADMIN_PASSWORD_HASH=$2a$10$....
```

- [ ] **Step 3: Boot dev server and test 401 + 200**

```bash
npm run dev
```

In another terminal:

```bash
curl -sI http://localhost:3000/admin/reports | head -1
# Expected: HTTP/1.1 401 Unauthorized

curl -sI -u admin:dev-pass http://localhost:3000/admin/reports | head -1
# Expected: HTTP/1.1 200 OK (after page exists; for now likely 404 since page not yet created — that's fine, the auth step succeeded)
```

Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add proxy.ts
git commit -m "feat(p4): proxy.ts Basic Auth gate for /admin/* and /api/admin/*"
```

---

## Task 6: robots.txt

**Files:** Create `public/robots.txt`

- [ ] **Step 1: Create the file**

```text
User-agent: *
Disallow: /admin/
```

- [ ] **Step 2: Commit**

```bash
git add public/robots.txt
git commit -m "feat(p4): robots.txt — disallow /admin/"
```

---

## Task 7: getPendingReports + getPendingCount queries

**Files:** Create `lib/queries/reports.ts`, `tests/lib/queries/reports.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/queries/reports.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db';
import { images, reports } from '@/db/schema';
import { getPendingReports, getPendingCount } from '@/lib/queries/reports';

const baseImage = {
  collectionId: 'c',
  source: 'inaturalist' as const,
  sourceId: 's',
  sourcePageUrl: 'u',
  imageUrl: 'u',
  filename: 'images/x.jpg',
  thumbnailFilename: 'thumbnails/x.jpg',
  mediumFilename: 'medium/x.jpg',
  fileSha256: 'sha',
  license: 'CC0-1.0',
  subjectType: 'nature' as const,
  hidden: false,
};

describe('getPendingReports', () => {
  beforeEach(() => {
    db.delete(reports).run();
    db.delete(images).run();
  });

  it('returns empty array when nothing pending', async () => {
    expect(await getPendingReports()).toEqual([]);
  });

  it('returns pending reports joined with image metadata, newest first', async () => {
    db.insert(images).values([
      { ...baseImage, imageId: 'img-a', commonName: 'A' },
      { ...baseImage, imageId: 'img-b', commonName: 'B' },
    ]).run();
    db.insert(reports).values([
      { imageId: 'img-a', category: 'low-resolution', createdAt: new Date(1_000_000) },
      { imageId: 'img-b', category: 'spooky', createdAt: new Date(2_000_000) },
    ]).run();

    const r = await getPendingReports();
    expect(r.length).toBe(2);
    expect(r[0].image_id).toBe('img-b'); // newest
    expect(r[1].image_id).toBe('img-a');
    expect(r[0].common_name).toBe('B');
    expect(r[0].thumbnail_filename).toBe('thumbnails/x.jpg');
  });

  it('excludes resolved reports', async () => {
    db.insert(images).values({ ...baseImage, imageId: 'img-a' }).run();
    db.insert(reports).values([
      { imageId: 'img-a', category: 'spooky', resolvedAt: new Date(1_000_000), resolvedAction: 'dismissed' },
      { imageId: 'img-a', category: 'cropped' },
    ]).run();

    const r = await getPendingReports();
    expect(r.length).toBe(1);
    expect(r[0].category).toBe('cropped');
  });

  it('includes the "other" message field', async () => {
    db.insert(images).values({ ...baseImage, imageId: 'img-a' }).run();
    db.insert(reports).values({
      imageId: 'img-a',
      category: 'other',
      message: 'weird crop',
    }).run();

    const r = await getPendingReports();
    expect(r[0].message).toBe('weird crop');
  });
});

describe('getPendingCount', () => {
  beforeEach(() => {
    db.delete(reports).run();
    db.delete(images).run();
  });

  it('returns 0 when nothing pending', async () => {
    expect(await getPendingCount()).toBe(0);
  });

  it('counts only unresolved', async () => {
    db.insert(images).values({ ...baseImage, imageId: 'img-a' }).run();
    db.insert(reports).values([
      { imageId: 'img-a', category: 'spooky' },
      { imageId: 'img-a', category: 'cropped', resolvedAt: new Date(1000), resolvedAction: 'dismissed' },
    ]).run();
    expect(await getPendingCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/queries/reports.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the queries**

```typescript
// lib/queries/reports.ts
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { cacheTag, cacheLife } from "next/cache";

export type PendingReport = {
  id: number;
  image_id: string;
  category: string;
  message: string | null;
  created_at: number;
  thumbnail_filename: string;
  source: string;
  source_page_url: string;
  common_name: string | null;
  taxon_species: string | null;
  taxon_order: string | null;
  hidden: number;
};

export async function getPendingReports(): Promise<PendingReport[]> {
  'use cache';
  cacheTag('reports');
  cacheLife('minutes');

  return db.all<PendingReport>(sql`
    SELECT
      r.id, r.image_id, r.category, r.message, r.created_at,
      i.thumbnail_filename, i.source, i.source_page_url,
      i.common_name, i.taxon_species, i.taxon_order, i.hidden
    FROM reports r
    JOIN images i ON i.image_id = r.image_id
    WHERE r.resolved_at IS NULL
    ORDER BY r.created_at DESC, r.id DESC
  `);
}

export async function getPendingCount(): Promise<number> {
  'use cache';
  cacheTag('reports');
  cacheLife('minutes');

  const row = db.get<{ c: number }>(sql`
    SELECT COUNT(*) AS c FROM reports WHERE resolved_at IS NULL
  `);
  return row?.c ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/queries/reports.test.ts`
Expected: PASS (6 total).

- [ ] **Step 5: Commit**

```bash
git add lib/queries/reports.ts tests/lib/queries/reports.test.ts
git commit -m "feat(p4): getPendingReports + getPendingCount queries"
```

---

## Task 8: submitReport server function

**Files:** Create `actions/submitReport.ts`, `tests/actions/submitReport.test.ts`

The student-facing mutation. No admin auth required (anonymous students submit). Validates category enum + length cap on message.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/actions/submitReport.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));

import { db } from '@/db';
import { images, reports } from '@/db/schema';
import { submitReport } from '@/actions/submitReport';
import { revalidateTag } from 'next/cache';

const baseImage = {
  collectionId: 'c',
  source: 'inaturalist' as const,
  sourceId: 's',
  sourcePageUrl: 'u',
  imageUrl: 'u',
  filename: 'images/x.jpg',
  thumbnailFilename: 'thumbnails/x.jpg',
  mediumFilename: 'medium/x.jpg',
  fileSha256: 'sha',
  license: 'CC0-1.0',
  subjectType: 'nature' as const,
  hidden: false,
};

describe('submitReport', () => {
  beforeEach(() => {
    db.delete(reports).run();
    db.delete(images).run();
    db.insert(images).values({ ...baseImage, imageId: 'img-1' }).run();
    vi.clearAllMocks();
  });

  it('inserts a report row with the right category', async () => {
    await submitReport({ imageId: 'img-1', category: 'spooky', message: null });
    const rows = db.all<{ image_id: string; category: string }>(
      sql`SELECT image_id, category FROM reports`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].category).toBe('spooky');
  });

  it('stores message only when category=other', async () => {
    await submitReport({ imageId: 'img-1', category: 'other', message: 'weird' });
    const r = db.get<{ message: string | null }>(sql`SELECT message FROM reports WHERE image_id = 'img-1'`);
    expect(r?.message).toBe('weird');
  });

  it('ignores message when category is not "other"', async () => {
    await submitReport({ imageId: 'img-1', category: 'low-resolution', message: 'should be dropped' });
    const r = db.get<{ message: string | null }>(sql`SELECT message FROM reports WHERE image_id = 'img-1'`);
    expect(r?.message).toBe(null);
  });

  it('rejects invalid category', async () => {
    await expect(
      submitReport({ imageId: 'img-1', category: 'bogus' as any, message: null }),
    ).rejects.toThrow(/category/i);
  });

  it('truncates message to 250 chars', async () => {
    const longMsg = 'x'.repeat(500);
    await submitReport({ imageId: 'img-1', category: 'other', message: longMsg });
    const r = db.get<{ message: string }>(sql`SELECT message FROM reports WHERE image_id = 'img-1'`);
    expect(r.message.length).toBe(250);
  });

  it('rejects unknown image_id', async () => {
    await expect(
      submitReport({ imageId: 'does-not-exist', category: 'spooky', message: null }),
    ).rejects.toThrow();
  });

  it('invalidates reports, gallery-results, images-stats', async () => {
    await submitReport({ imageId: 'img-1', category: 'spooky', message: null });
    expect(revalidateTag).toHaveBeenCalledWith('reports', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('gallery-results', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('images-stats', 'max');
    expect(revalidateTag).not.toHaveBeenCalledWith('species-index', 'max');
  });
});

import { sql } from 'drizzle-orm';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/submitReport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement submitReport**

```typescript
// actions/submitReport.ts
'use server';

import { db } from '@/db';
import { images, reports } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { invalidateOnReportSubmit } from './_invalidation';

export const REPORT_CATEGORIES = [
  'low-resolution',
  'spooky',
  'cropped',
  'ai-generated',
  'other',
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export interface SubmitReportArgs {
  imageId: string;
  category: ReportCategory;
  message: string | null;
}

const MESSAGE_MAX = 250;

export async function submitReport(args: SubmitReportArgs): Promise<void> {
  if (!REPORT_CATEGORIES.includes(args.category)) {
    throw new Error(`invalid category: ${args.category}`);
  }

  const existing = db.select().from(images).where(eq(images.imageId, args.imageId)).all();
  if (existing.length === 0) {
    throw new Error(`unknown imageId: ${args.imageId}`);
  }

  let message: string | null = null;
  if (args.category === 'other' && args.message) {
    message = args.message.slice(0, MESSAGE_MAX);
  }

  db.insert(reports).values({
    imageId: args.imageId,
    category: args.category,
    message,
  }).run();

  invalidateOnReportSubmit();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/actions/submitReport.test.ts`
Expected: PASS (7).

- [ ] **Step 5: Commit**

```bash
git add actions/submitReport.ts tests/actions/submitReport.test.ts
git commit -m "feat(p4): submitReport server function"
```

---

## Task 9: dismissReport server function

**Files:** Create `actions/dismissReport.ts`, `tests/actions/dismissReport.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/actions/dismissReport.test.ts
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));

let mockHeader: string | null = null;
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: (k: string) => (k.toLowerCase() === 'authorization' ? mockHeader : null) }),
}));

import { db } from '@/db';
import { images, reports } from '@/db/schema';
import { sql, eq } from 'drizzle-orm';
import { dismissReport } from '@/actions/dismissReport';
import { revalidateTag } from 'next/cache';

const baseImage = {
  collectionId: 'c',
  source: 'inaturalist' as const,
  sourceId: 's',
  sourcePageUrl: 'u',
  imageUrl: 'u',
  filename: 'f',
  thumbnailFilename: 't',
  mediumFilename: 'm',
  fileSha256: 'sha',
  license: 'CC0-1.0',
  subjectType: 'nature' as const,
  hidden: false,
};

describe('dismissReport', () => {
  beforeAll(() => {
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('hunter2', 10);
  });

  beforeEach(() => {
    db.delete(reports).run();
    db.delete(images).run();
    db.insert(images).values({ ...baseImage, imageId: 'img-1' }).run();
    vi.clearAllMocks();
  });

  it('marks the report resolved with action=dismissed', async () => {
    db.insert(reports).values({ imageId: 'img-1', category: 'spooky' }).run();
    const row = db.get<{ id: number }>(sql`SELECT id FROM reports LIMIT 1`)!;

    mockHeader = 'Basic ' + btoa('admin:hunter2');
    await dismissReport(row.id);

    const updated = db.get<{ resolved_at: number; resolved_action: string }>(
      sql`SELECT resolved_at, resolved_action FROM reports WHERE id = ${row.id}`
    )!;
    expect(updated.resolved_at).toBeGreaterThan(0);
    expect(updated.resolved_action).toBe('dismissed');
  });

  it('does not change images.hidden', async () => {
    db.insert(reports).values({ imageId: 'img-1', category: 'spooky' }).run();
    const row = db.get<{ id: number }>(sql`SELECT id FROM reports LIMIT 1`)!;

    mockHeader = 'Basic ' + btoa('admin:hunter2');
    await dismissReport(row.id);

    const img = db.get<{ hidden: number }>(sql`SELECT hidden FROM images WHERE image_id = 'img-1'`)!;
    expect(img.hidden).toBe(0);
  });

  it('invalidates reports + gallery-results only', async () => {
    db.insert(reports).values({ imageId: 'img-1', category: 'spooky' }).run();
    const row = db.get<{ id: number }>(sql`SELECT id FROM reports LIMIT 1`)!;

    mockHeader = 'Basic ' + btoa('admin:hunter2');
    await dismissReport(row.id);

    expect(revalidateTag).toHaveBeenCalledWith('reports', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('gallery-results', 'max');
    expect(revalidateTag).not.toHaveBeenCalledWith('images-stats', 'max');
  });

  it('throws unauthorized without valid creds', async () => {
    db.insert(reports).values({ imageId: 'img-1', category: 'spooky' }).run();
    const row = db.get<{ id: number }>(sql`SELECT id FROM reports LIMIT 1`)!;

    mockHeader = null;
    await expect(dismissReport(row.id)).rejects.toThrow(/unauthorized/i);
  });

  it('throws on unknown report id', async () => {
    mockHeader = 'Basic ' + btoa('admin:hunter2');
    await expect(dismissReport(999_999)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/dismissReport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement dismissReport**

```typescript
// actions/dismissReport.ts
'use server';

import { db } from '@/db';
import { reports } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth';
import { invalidateOnDismiss } from './_invalidation';

export async function dismissReport(reportId: number): Promise<void> {
  await requireAdmin();

  const existing = db.select().from(reports).where(eq(reports.id, reportId)).all();
  if (existing.length === 0) {
    throw new Error(`unknown report id: ${reportId}`);
  }

  db.update(reports)
    .set({
      resolvedAt: new Date(),
      resolvedAction: 'dismissed',
    })
    .where(eq(reports.id, reportId))
    .run();

  invalidateOnDismiss();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/actions/dismissReport.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add actions/dismissReport.ts tests/actions/dismissReport.test.ts
git commit -m "feat(p4): dismissReport server function"
```

---

## Task 10: hideImage server function

**Files:** Create `actions/hideImage.ts`, `tests/actions/hideImage.test.ts`

Sets `images.hidden = 1` AND resolves all pending reports for that image with action `image-hidden`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/actions/hideImage.test.ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));

let mockHeader: string | null = null;
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: (k: string) => (k.toLowerCase() === 'authorization' ? mockHeader : null) }),
}));

import { db } from '@/db';
import { images, reports } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { hideImage } from '@/actions/hideImage';
import { revalidateTag } from 'next/cache';

const baseImage = {
  collectionId: 'c',
  source: 'inaturalist' as const,
  sourceId: 's',
  sourcePageUrl: 'u',
  imageUrl: 'u',
  filename: 'f',
  thumbnailFilename: 't',
  mediumFilename: 'm',
  fileSha256: 'sha',
  license: 'CC0-1.0',
  subjectType: 'nature' as const,
  hidden: false,
};

describe('hideImage', () => {
  beforeAll(() => {
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('hunter2', 10);
  });

  beforeEach(() => {
    db.delete(reports).run();
    db.delete(images).run();
    db.insert(images).values({ ...baseImage, imageId: 'img-1' }).run();
    db.insert(reports).values([
      { imageId: 'img-1', category: 'spooky' },
      { imageId: 'img-1', category: 'cropped' },
    ]).run();
    vi.clearAllMocks();
    mockHeader = 'Basic ' + btoa('admin:hunter2');
  });

  it('sets images.hidden = 1', async () => {
    await hideImage('img-1');
    const img = db.get<{ hidden: number }>(sql`SELECT hidden FROM images WHERE image_id = 'img-1'`)!;
    expect(img.hidden).toBe(1);
  });

  it('resolves all pending reports for the image with action=image-hidden', async () => {
    await hideImage('img-1');
    const rows = db.all<{ resolved_action: string; resolved_at: number }>(
      sql`SELECT resolved_action, resolved_at FROM reports WHERE image_id = 'img-1'`,
    );
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.resolved_action).toBe('image-hidden');
      expect(r.resolved_at).toBeGreaterThan(0);
    }
  });

  it('invalidates reports + gallery-results + images-stats', async () => {
    await hideImage('img-1');
    expect(revalidateTag).toHaveBeenCalledWith('reports', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('gallery-results', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('images-stats', 'max');
    expect(revalidateTag).not.toHaveBeenCalledWith('species-index', 'max');
  });

  it('throws unauthorized without creds', async () => {
    mockHeader = null;
    await expect(hideImage('img-1')).rejects.toThrow(/unauthorized/i);
  });

  it('throws on unknown image_id', async () => {
    await expect(hideImage('does-not-exist')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/hideImage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement hideImage**

```typescript
// actions/hideImage.ts
'use server';

import { db } from '@/db';
import { images, reports } from '@/db/schema';
import { eq, isNull, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth';
import { invalidateOnHide } from './_invalidation';

export async function hideImage(imageId: string): Promise<void> {
  await requireAdmin();

  const existing = db.select().from(images).where(eq(images.imageId, imageId)).all();
  if (existing.length === 0) {
    throw new Error(`unknown imageId: ${imageId}`);
  }

  db.transaction((tx) => {
    tx.update(images).set({ hidden: true }).where(eq(images.imageId, imageId)).run();
    tx.update(reports)
      .set({
        resolvedAt: new Date(),
        resolvedAction: 'image-hidden',
      })
      .where(and(eq(reports.imageId, imageId), isNull(reports.resolvedAt)))
      .run();
  });

  invalidateOnHide();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/actions/hideImage.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add actions/hideImage.ts tests/actions/hideImage.test.ts
git commit -m "feat(p4): hideImage server function (sets hidden + resolves reports)"
```

---

## Task 11: deleteImage server function

**Files:** Create `actions/deleteImage.ts`, `tests/actions/deleteImage.test.ts`

The destructive one. Removes the three on-disk files (full/medium/thumb), then deletes the DB row. Reports cascade-delete via FK. Touches FTS via trigger (covered by P1 0001_fts5.sql AFTER DELETE).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/actions/deleteImage.test.ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}));

let mockHeader: string | null = null;
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: (k: string) => (k.toLowerCase() === 'authorization' ? mockHeader : null) }),
}));

import { db } from '@/db';
import { images, reports } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { deleteImage } from '@/actions/deleteImage';
import { revalidateTag } from 'next/cache';

function writeFixtureImage(name: string) {
  const dataDir = path.join(process.cwd(), 'data');
  for (const tier of ['images', 'medium', 'thumbnails']) {
    const dir = path.join(dataDir, tier);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  }
  return {
    filename: `images/${name}`,
    thumbnailFilename: `thumbnails/${name}`,
    mediumFilename: `medium/${name}`,
  };
}

const baseImage = {
  collectionId: 'c',
  source: 'inaturalist' as const,
  sourceId: 's',
  sourcePageUrl: 'u',
  imageUrl: 'u',
  fileSha256: 'sha',
  license: 'CC0-1.0',
  subjectType: 'nature' as const,
  hidden: false,
};

describe('deleteImage', () => {
  beforeAll(() => {
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('hunter2', 10);
  });

  beforeEach(() => {
    db.delete(reports).run();
    db.delete(images).run();
    vi.clearAllMocks();
    mockHeader = 'Basic ' + btoa('admin:hunter2');
  });

  it('removes the DB row and cascades reports', async () => {
    const files = writeFixtureImage('test-1.jpg');
    db.insert(images).values({ ...baseImage, imageId: 'img-1', ...files }).run();
    db.insert(reports).values({ imageId: 'img-1', category: 'spooky' }).run();

    await deleteImage('img-1');

    const img = db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM images WHERE image_id = 'img-1'`)!;
    expect(img.c).toBe(0);
    const rep = db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM reports WHERE image_id = 'img-1'`)!;
    expect(rep.c).toBe(0);
  });

  it('removes the three on-disk files', async () => {
    const files = writeFixtureImage('test-2.jpg');
    db.insert(images).values({ ...baseImage, imageId: 'img-2', ...files }).run();
    const dataDir = path.join(process.cwd(), 'data');

    await deleteImage('img-2');

    expect(fs.existsSync(path.join(dataDir, 'images/test-2.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'medium/test-2.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'thumbnails/test-2.jpg'))).toBe(false);
  });

  it('completes even if a file is already missing on disk', async () => {
    const files = writeFixtureImage('test-3.jpg');
    fs.rmSync(path.join(process.cwd(), 'data', 'medium', 'test-3.jpg'));
    db.insert(images).values({ ...baseImage, imageId: 'img-3', ...files }).run();

    await expect(deleteImage('img-3')).resolves.not.toThrow();
    const c = db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM images WHERE image_id = 'img-3'`)!;
    expect(c.c).toBe(0);
  });

  it('invalidates all four tags', async () => {
    const files = writeFixtureImage('test-4.jpg');
    db.insert(images).values({ ...baseImage, imageId: 'img-4', ...files }).run();

    await deleteImage('img-4');

    expect(revalidateTag).toHaveBeenCalledWith('reports', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('gallery-results', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('images-stats', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('species-index', 'max');
  });

  it('throws unauthorized without creds', async () => {
    mockHeader = null;
    await expect(deleteImage('img-1')).rejects.toThrow(/unauthorized/i);
  });

  it('throws on unknown image_id', async () => {
    await expect(deleteImage('does-not-exist')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/deleteImage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement deleteImage**

```typescript
// actions/deleteImage.ts
'use server';

import { db } from '@/db';
import { images } from '@/db/schema';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { requireAdmin } from '@/lib/auth';
import { invalidateOnDelete } from './_invalidation';

function safePath(rel: string): string {
  // rel is "images/foo.jpg" etc. — strip any path traversal and resolve under data/.
  const cleaned = rel.replace(/\.\./g, '').replace(/^\/+/, '');
  return path.join(process.cwd(), 'data', cleaned);
}

function unlinkIfExists(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function deleteImage(imageId: string): Promise<void> {
  await requireAdmin();

  const existing = db.select().from(images).where(eq(images.imageId, imageId)).all();
  if (existing.length === 0) {
    throw new Error(`unknown imageId: ${imageId}`);
  }
  const row = existing[0];

  // Delete DB row first — reports cascade via FK, FTS trigger fires.
  // If file unlinks fail mid-way, the row is still gone and gallery is consistent.
  db.delete(images).where(eq(images.imageId, imageId)).run();

  unlinkIfExists(safePath(row.filename));
  unlinkIfExists(safePath(row.mediumFilename));
  unlinkIfExists(safePath(row.thumbnailFilename));

  invalidateOnDelete();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/actions/deleteImage.test.ts`
Expected: PASS (6).

- [ ] **Step 5: Commit**

```bash
git add actions/deleteImage.ts tests/actions/deleteImage.test.ts
git commit -m "feat(p4): deleteImage server function (DB + files + cache)"
```

---

## Task 12: ReportCategoryChips

**Files:** Create `app/components/report/ReportCategoryChips.tsx`, `tests/components/ReportCategoryChips.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/components/ReportCategoryChips.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportCategoryChips } from '@/app/components/report/ReportCategoryChips';

describe('ReportCategoryChips', () => {
  it('renders all 5 categories', () => {
    render(<ReportCategoryChips value={null} onChange={vi.fn()} />);
    expect(screen.getByText(/low-resolution/i)).toBeTruthy();
    expect(screen.getByText(/spooky/i)).toBeTruthy();
    expect(screen.getByText(/cropped/i)).toBeTruthy();
    expect(screen.getByText(/ai-generated/i)).toBeTruthy();
    expect(screen.getByText(/other/i)).toBeTruthy();
  });

  it('clicking emits onChange with category', () => {
    const onChange = vi.fn();
    render(<ReportCategoryChips value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /spooky/i }));
    expect(onChange).toHaveBeenCalledWith('spooky');
  });

  it('marks selected chip with aria-pressed=true', () => {
    render(<ReportCategoryChips value="cropped" onChange={vi.fn()} />);
    const chip = screen.getByRole('button', { name: /cropped/i });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('only one chip can be active', () => {
    render(<ReportCategoryChips value="spooky" onChange={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    const pressed = buttons.filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ReportCategoryChips.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// app/components/report/ReportCategoryChips.tsx
'use client';

import type { ReportCategory } from '@/actions/submitReport';

const CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'low-resolution', label: 'low-resolution' },
  { value: 'spooky', label: 'spooky' },
  { value: 'cropped', label: 'cropped' },
  { value: 'ai-generated', label: 'ai-generated' },
  { value: 'other', label: 'other' },
];

export interface ReportCategoryChipsProps {
  value: ReportCategory | null;
  onChange: (v: ReportCategory) => void;
}

export function ReportCategoryChips({ value, onChange }: ReportCategoryChipsProps) {
  return (
    <div className="report-category-chips" role="group" aria-label="report category">
      {CATEGORIES.map((c) => (
        <button
          key={c.value}
          type="button"
          className={`chip ${value === c.value ? 'chip-active' : ''}`}
          aria-pressed={value === c.value}
          onClick={() => onChange(c.value)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ReportCategoryChips.test.tsx`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add app/components/report/ReportCategoryChips.tsx tests/components/ReportCategoryChips.test.tsx
git commit -m "feat(p4): ReportCategoryChips"
```

---

## Task 13: ReportForm

**Files:** Create `app/components/report/ReportForm.tsx`, `tests/components/ReportForm.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/components/ReportForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReportForm } from '@/app/components/report/ReportForm';

describe('ReportForm', () => {
  it('renders chips and a submit button', () => {
    render(<ReportForm imageId="img-1" onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/low-resolution/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /submit/i })).toBeTruthy();
  });

  it('submit is disabled without a chosen category', () => {
    render(<ReportForm imageId="img-1" onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByRole('button', { name: /submit/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('picking "other" reveals the textarea', () => {
    render(<ReportForm imageId="img-1" onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /other/i }));
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('textarea has a 250-char cap (maxLength attr)', () => {
    render(<ReportForm imageId="img-1" onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /other/i }));
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(250);
  });

  it('submitting non-other calls onSubmit with null message', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ReportForm imageId="img-1" onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /spooky/i }));
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ imageId: 'img-1', category: 'spooky', message: null }),
    );
  });

  it('submitting other with text calls onSubmit with message', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ReportForm imageId="img-1" onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /other/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ imageId: 'img-1', category: 'other', message: 'hello' }),
    );
  });

  it('after successful submit, calls onClose', async () => {
    const onClose = vi.fn();
    render(<ReportForm imageId="img-1" onSubmit={vi.fn().mockResolvedValue(undefined)} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cropped/i }));
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ReportForm.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ReportForm**

```typescript
// app/components/report/ReportForm.tsx
'use client';

import { useState } from 'react';
import type { ReportCategory, SubmitReportArgs } from '@/actions/submitReport';
import { ReportCategoryChips } from './ReportCategoryChips';

export interface ReportFormProps {
  imageId: string;
  onSubmit: (args: SubmitReportArgs) => Promise<void>;
  onClose: () => void;
}

export function ReportForm({ imageId, onSubmit, onClose }: ReportFormProps) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = category !== null && !submitting;

  async function handleSubmit() {
    if (!category) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        imageId,
        category,
        message: category === 'other' && message.trim().length > 0 ? message : null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to submit');
      setSubmitting(false);
    }
  }

  return (
    <form
      className="report-form"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <h2>report this image</h2>
      <p className="report-form-help">why should the admin take another look?</p>
      <ReportCategoryChips value={category} onChange={setCategory} />
      {category === 'other' && (
        <textarea
          maxLength={250}
          rows={4}
          placeholder="tell us a bit more (optional, 250 chars)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      )}
      {error && <p className="report-form-error">{error}</p>}
      <div className="report-form-actions">
        <button type="button" onClick={onClose}>cancel</button>
        <button type="submit" disabled={!canSubmit}>
          {submitting ? 'submitting…' : 'submit'}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ReportForm.test.tsx`
Expected: PASS (7).

- [ ] **Step 5: Commit**

```bash
git add app/components/report/ReportForm.tsx tests/components/ReportForm.test.tsx
git commit -m "feat(p4): ReportForm with chips + conditional textarea"
```

---

## Task 14: Modal frame component

**Files:** Create `app/components/modal/Modal.tsx`, `tests/components/Modal.test.tsx`

Generic modal shell used by the intercepting route. Owns focus trap, Escape-to-close, click-outside-to-close.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/components/Modal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '@/app/components/modal/Modal';

describe('Modal', () => {
  it('renders children inside a dialog', () => {
    render(
      <Modal onClose={vi.fn()}>
        <p>inside</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('inside')).toBeTruthy();
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose}><p>x</p></Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('click on backdrop calls onClose', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose}><p>x</p></Modal>);
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('click inside dialog does NOT call onClose', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose}><p>x</p></Modal>);
    fireEvent.click(screen.getByText('x'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/Modal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Modal**

```typescript
// app/components/modal/Modal.tsx
'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({ onClose, children, ariaLabel }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Trap Tab focus within the dialog. Spec §10 modal is over the session
      // view — leaking focus out lets shortcuts hit the underlying SessionPlayer.
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    // Restore body scroll when modal unmounts
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    // Auto-focus the first focusable element on open so keyboard users land
    // inside the dialog. Restore focus to the previously-active element on close.
    const prevFocus = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => prevFocus?.focus();
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/Modal.test.tsx`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add app/components/modal/Modal.tsx tests/components/Modal.test.tsx
git commit -m "feat(p4): Modal frame with backdrop + Escape close"
```

---

## Task 15: Full-page /report/[id] route (URL hit / refresh)

**Files:** Create `app/report/[id]/page.tsx`

This is the page hit when someone reloads the URL or shares the link. The intercepting modal renders the same content over the previous view.

- [ ] **Step 1: Implement**

```typescript
// app/report/[id]/page.tsx
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { images } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { ReportPageClient } from './ReportPageClient';

type Params = Promise<{ id: string }>;

export default async function ReportPage({ params }: { params: Params }) {
  const { id } = await params;
  const row = db.select().from(images).where(eq(images.imageId, id)).all();
  if (row.length === 0) notFound();
  const img = row[0];

  return (
    <main className="report-page">
      <header className="report-page-header">
        <a href="/" className="report-page-back">← back</a>
      </header>
      <ReportPageClient
        imageId={id}
        thumbnail={img.thumbnailFilename}
        commonName={img.commonName}
        speciesName={img.taxonSpecies}
      />
    </main>
  );
}
```

- [ ] **Step 2: Implement the client wrapper**

```typescript
// app/report/[id]/ReportPageClient.tsx
'use client';

import { useRouter } from 'next/navigation';
import { ReportForm } from '@/app/components/report/ReportForm';
import { submitReport } from '@/actions/submitReport';

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

interface ReportPageClientProps {
  imageId: string;
  thumbnail: string;
  commonName: string | null;
  speciesName: string | null;
}

export function ReportPageClient({ imageId, thumbnail, commonName, speciesName }: ReportPageClientProps) {
  const router = useRouter();
  return (
    <div className="report-page-content">
      <div className="report-page-preview">
        <img src={`/api/thumb/${basename(thumbnail)}`} alt="" />
        <p className="preview-name">{commonName ?? speciesName ?? imageId}</p>
      </div>
      <ReportForm
        imageId={imageId}
        onSubmit={submitReport}
        onClose={() => router.push('/')}
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/report/[id]/page.tsx app/report/[id]/ReportPageClient.tsx
git commit -m "feat(p4): /report/[id] full-page form (URL/refresh path)"
```

---

## Task 16: @modal slot scaffolding

**Files:** Modify `app/layout.tsx`, create `app/@modal/default.tsx`

- [ ] **Step 1: Add @modal to the root layout signature**

```typescript
// app/layout.tsx — extend the existing component
export default function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ReactQueryProvider>
          {children}
          {modal}
        </ReactQueryProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Add the default null slot**

```typescript
// app/@modal/default.tsx
export default function Default() {
  return null;
}
```

- [ ] **Step 3: Sanity-check build**

Run: `npm run build`
Expected: builds without errors.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/@modal/default.tsx
git commit -m "feat(p4): parallel @modal slot scaffold"
```

---

## Task 17: Intercepting modal route — /@modal/(.)report/[id]

**Files:** Create `app/@modal/(.)report/[id]/page.tsx`

This route activates when a navigation from a sibling route (e.g., `/session`) hits `/report/[id]`. The `(.)` prefix is the intercept marker.

- [ ] **Step 1: Implement**

```typescript
// app/@modal/(.)report/[id]/page.tsx
import { db } from '@/db';
import { images } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { ReportModalClient } from './ReportModalClient';

type Params = Promise<{ id: string }>;

export default async function ReportModalRoute({ params }: { params: Params }) {
  const { id } = await params;
  const row = db.select().from(images).where(eq(images.imageId, id)).all();
  if (row.length === 0) notFound();
  const img = row[0];

  return (
    <ReportModalClient
      imageId={id}
      thumbnail={img.thumbnailFilename}
      commonName={img.commonName}
      speciesName={img.taxonSpecies}
    />
  );
}
```

```typescript
// app/@modal/(.)report/[id]/ReportModalClient.tsx
'use client';

import { useRouter } from 'next/navigation';
import { Modal } from '@/app/components/modal/Modal';
import { ReportForm } from '@/app/components/report/ReportForm';
import { submitReport } from '@/actions/submitReport';

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

interface ReportModalClientProps {
  imageId: string;
  thumbnail: string;
  commonName: string | null;
  speciesName: string | null;
}

export function ReportModalClient({ imageId, thumbnail, commonName, speciesName }: ReportModalClientProps) {
  const router = useRouter();
  const close = () => router.back();
  return (
    <Modal onClose={close} ariaLabel="report image">
      <div className="report-modal-content">
        <div className="report-modal-preview">
          <img src={`/api/thumb/${basename(thumbnail)}`} alt="" />
          <p className="preview-name">{commonName ?? speciesName ?? imageId}</p>
        </div>
        <ReportForm
          imageId={imageId}
          onSubmit={submitReport}
          onClose={close}
        />
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/@modal/(.)report/[id]/page.tsx app/@modal/(.)report/[id]/ReportModalClient.tsx
git commit -m "feat(p4): @modal intercepting route for /report/[id]"
```

---

## Task 18: Wire SessionPlayer Report button + R key

**Files:** Modify session components built in P2 — `SessionPlayer.tsx`

- [ ] **Step 1: Add `onReport` handler that navigates to `/report/<id>`**

In `SessionPlayer.tsx`, locate the keyboard handler block (added in P2 Task 14ish). Augment:

```typescript
// inside SessionPlayer.tsx, near other keyboard cases:
import { useRouter } from 'next/navigation';
// ...
const router = useRouter();
// ...
case 'r':
case 'R':
  router.push(`/report/${currentImage.image_id}`);
  break;
```

And add the `onClick` on the existing Report button in `SessionActionBar.tsx`:

```typescript
<IconBtn
  icon="report"
  label="report"
  onClick={() => router.push(`/report/${currentImageId}`)}
/>
```

(The exact location depends on P2's structure; preserve the existing icon name + label.)

- [ ] **Step 2: Confirm chrome force-show + pause-on-modal**

Inside `SessionPlayer.tsx`, add a `usePathname()` check. When pathname matches `/report/`, force `paused=true` and `chromeVisible=true`:

```typescript
const pathname = usePathname();
const isReportOpen = pathname.startsWith('/report/');

// in your useHighResTimer call:
useHighResTimer(durationMs, active && !isReportOpen, onTick, onEnd, resetKey);

// in your chrome-hide effect: bypass the hide when isReportOpen is true
```

- [ ] **Step 3: Manual sanity-test**

```bash
npm run dev
```

1. Start a session
2. Press `R` → modal appears over the player
3. Underlying timer is paused
4. Cancel → back to session, timer resumes
5. Esc closes modal as well

Kill dev server.

- [ ] **Step 4: Commit**

```bash
git add app/components/session/SessionPlayer.tsx app/components/session/SessionActionBar.tsx
git commit -m "feat(p4): wire SessionPlayer Report button + R-key + pause-on-modal"
```

---

## Task 19: Toast on report submit

**Files:** Create `app/components/ui/Toast.tsx`, modify `ReportForm.tsx` or its parents

Simple, in-house, no new dep. Renders a transient lower-right banner with `aria-live=polite`.

- [ ] **Step 1: Implement Toast**

```typescript
// app/components/ui/Toast.tsx
'use client';

import { useEffect, useState } from 'react';

let toastQueue: string[] = [];
const listeners = new Set<(messages: string[]) => void>();

export function showToast(msg: string): void {
  toastQueue = [...toastQueue, msg];
  listeners.forEach((l) => l(toastQueue));
  setTimeout(() => {
    toastQueue = toastQueue.filter((m) => m !== msg);
    listeners.forEach((l) => l(toastQueue));
  }, 3500);
}

export function ToastHost() {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    listeners.add(setMessages);
    return () => { listeners.delete(setMessages); };
  }, []);
  return (
    <div className="toast-host" aria-live="polite">
      {messages.map((m, i) => (
        <div key={`${m}-${i}`} className="toast">{m}</div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Mount the host in root layout**

```typescript
// app/layout.tsx — add ToastHost inside <body>
import { ToastHost } from './components/ui/Toast';
// ...
<ToastHost />
```

- [ ] **Step 3: Call showToast inside ReportForm.handleSubmit (right before onClose)**

```typescript
// ReportForm.tsx — already-implemented handleSubmit:
import { showToast } from '@/app/components/ui/Toast';
// ...
await onSubmit({ ... });
showToast('thanks — admin will review');
onClose();
```

- [ ] **Step 4: Commit**

```bash
git add app/components/ui/Toast.tsx app/layout.tsx app/components/report/ReportForm.tsx
git commit -m "feat(p4): Toast host + report-submitted toast"
```

---

## Task 20: ConfirmDeleteButton (inline morph)

**Files:** Create `app/components/admin/ConfirmDeleteButton.tsx`, `tests/components/ConfirmDeleteButton.test.tsx`

Inline confirm pattern: first click "delete" → button morphs into red "are you sure?" → second click commits.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/components/ConfirmDeleteButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmDeleteButton } from '@/app/components/admin/ConfirmDeleteButton';

describe('ConfirmDeleteButton', () => {
  it('renders "delete" initially', () => {
    render(<ConfirmDeleteButton onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
  });

  it('first click morphs to "are you sure?" without calling onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDeleteButton onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByRole('button', { name: /are you sure/i })).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('second click calls onConfirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmDeleteButton onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: /are you sure/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  });

  it('button enters loading state after confirm click', async () => {
    let resolveFn: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => { resolveFn = r; }));
    render(<ConfirmDeleteButton onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: /are you sure/i }));
    await waitFor(() => expect(screen.getByText(/deleting/i)).toBeTruthy());
    resolveFn!();
  });

  it('reverts to "delete" after 3s of no second click', async () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<ConfirmDeleteButton onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    vi.advanceTimersByTime(3500);
    await waitFor(() => expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy());
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ConfirmDeleteButton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// app/components/admin/ConfirmDeleteButton.tsx
'use client';

import { useEffect, useRef, useState } from 'react';

export interface ConfirmDeleteButtonProps {
  onConfirm: () => Promise<void>;
}

export function ConfirmDeleteButton({ onConfirm }: ConfirmDeleteButtonProps) {
  const [stage, setStage] = useState<'idle' | 'armed' | 'loading'>('idle');
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (stage === 'armed') {
      armTimerRef.current = setTimeout(() => setStage('idle'), 3000);
    }
    return () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    };
  }, [stage]);

  async function onClick() {
    if (stage === 'idle') {
      setStage('armed');
      return;
    }
    if (stage === 'armed') {
      setStage('loading');
      try {
        await onConfirm();
      } finally {
        setStage('idle');
      }
    }
  }

  if (stage === 'loading') {
    return <button type="button" className="btn-destructive" disabled>deleting…</button>;
  }
  if (stage === 'armed') {
    return (
      <button type="button" className="btn-destructive btn-armed" onClick={onClick}>
        are you sure?
      </button>
    );
  }
  return (
    <button type="button" className="btn-destructive-idle" onClick={onClick}>
      delete
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ConfirmDeleteButton.test.tsx`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/ConfirmDeleteButton.tsx tests/components/ConfirmDeleteButton.test.tsx
git commit -m "feat(p4): ConfirmDeleteButton (inline-morph two-click confirm)"
```

---

## Task 21: ReportCard

**Files:** Create `app/components/admin/ReportCard.tsx`, `tests/components/ReportCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/components/ReportCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportCard } from '@/app/components/admin/ReportCard';
import type { PendingReport } from '@/lib/queries/reports';

const report: PendingReport = {
  id: 42,
  image_id: 'inat-12345',
  category: 'spooky',
  message: null,
  created_at: 1_700_000_000,
  thumbnail_filename: 'thumbnails/inat-12345.jpg',
  source: 'inaturalist',
  source_page_url: 'https://www.inaturalist.org/observations/123',
  common_name: 'wasp',
  taxon_species: 'Vespa mandarinia',
  taxon_order: 'Hymenoptera',
  hidden: 0,
};

describe('ReportCard', () => {
  it('renders thumbnail, category, image metadata', () => {
    render(<ReportCard report={report} onDismiss={vi.fn()} onHide={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('spooky')).toBeTruthy();
    expect(screen.getByText('wasp')).toBeTruthy();
    expect(screen.getByText('Vespa mandarinia')).toBeTruthy();
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('shows the message when present', () => {
    render(
      <ReportCard
        report={{ ...report, category: 'other', message: 'something weird' }}
        onDismiss={vi.fn()} onHide={vi.fn()} onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/something weird/i)).toBeTruthy();
  });

  it('Dismiss button calls onDismiss with id', () => {
    const onDismiss = vi.fn();
    render(<ReportCard report={report} onDismiss={onDismiss} onHide={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith(42);
  });

  it('Hide button calls onHide with image_id', () => {
    const onHide = vi.fn();
    render(<ReportCard report={report} onDismiss={vi.fn()} onHide={onHide} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /hide image/i }));
    expect(onHide).toHaveBeenCalledWith('inat-12345');
  });

  it('Delete is two-click (ConfirmDeleteButton)', () => {
    render(<ReportCard report={report} onDismiss={vi.fn()} onHide={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByRole('button', { name: /are you sure/i })).toBeTruthy();
  });

  it('source link points to upstream', () => {
    render(<ReportCard report={report} onDismiss={vi.fn()} onHide={vi.fn()} onDelete={vi.fn()} />);
    const link = screen.getByRole('link', { name: /source/i });
    expect(link.getAttribute('href')).toBe('https://www.inaturalist.org/observations/123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ReportCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// app/components/admin/ReportCard.tsx
'use client';

import type { PendingReport } from '@/lib/queries/reports';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { orderColor } from '@/lib/order-colors';

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

function formatAge(unixSeconds: number): string {
  const elapsed = Date.now() / 1000 - unixSeconds;
  if (elapsed < 60) return `${Math.floor(elapsed)}s ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  return `${Math.floor(elapsed / 86400)}d ago`;
}

export interface ReportCardProps {
  report: PendingReport;
  onDismiss: (reportId: number) => Promise<void> | void;
  onHide: (imageId: string) => Promise<void> | void;
  onDelete: (imageId: string) => Promise<void>;
}

export function ReportCard({ report, onDismiss, onHide, onDelete }: ReportCardProps) {
  return (
    <article className="report-card">
      <div className="report-card-thumb">
        <img src={`/api/thumb/${basename(report.thumbnail_filename)}`} alt="" />
        <span
          className="report-card-stripe"
          style={{ backgroundColor: orderColor(report.taxon_order) }}
        />
      </div>
      <div className="report-card-body">
        <header className="report-card-header">
          <span className="report-card-category">{report.category}</span>
          <span className="report-card-age">{formatAge(report.created_at)}</span>
        </header>
        <p className="report-card-name">
          {report.common_name ?? report.taxon_species ?? report.image_id}
        </p>
        <p className="report-card-meta">
          <span className="report-card-id">{report.image_id}</span>
          {' · '}
          <span className="report-card-source">{report.source}</span>
          {' · '}
          <a className="report-card-source-link" href={report.source_page_url} target="_blank" rel="noopener noreferrer">
            source ↗
          </a>
        </p>
        {report.message && <blockquote className="report-card-message">{report.message}</blockquote>}
        {report.hidden === 1 && <p className="report-card-warning">⚠ this image is already hidden</p>}
        <div className="report-card-actions">
          <button type="button" onClick={() => onDismiss(report.id)}>dismiss</button>
          <button type="button" onClick={() => onHide(report.image_id)}>hide image</button>
          <ConfirmDeleteButton onConfirm={() => Promise.resolve(onDelete(report.image_id))} />
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ReportCard.test.tsx`
Expected: PASS (6).

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/ReportCard.tsx tests/components/ReportCard.test.tsx
git commit -m "feat(p4): ReportCard with 3 actions + age + order-colored stripe"
```

---

## Task 22: AdminReports page

**Files:** Create `app/admin/reports/page.tsx`, `app/admin/reports/_actions.ts`

The page is RSC; the per-card actions are wrapped in a client component that calls the imported Server Functions.

- [ ] **Step 1: Client action wrapper**

```typescript
// app/admin/reports/_actions.ts
'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PendingReport } from '@/lib/queries/reports';
import { ReportCard } from '@/app/components/admin/ReportCard';

export interface ReportListClientProps {
  reports: PendingReport[];
  actions: {
    dismiss: (id: number) => Promise<void>;
    hide: (imageId: string) => Promise<void>;
    deleteImg: (imageId: string) => Promise<void>;
  };
}

export function ReportListClient({ reports, actions }: ReportListClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function refresh() {
    startTransition(() => router.refresh());
  }

  if (reports.length === 0) {
    return <p className="admin-empty">no pending reports — nice job, students 🌿</p>;
  }

  return (
    <div className="report-list">
      {reports.map((r) => (
        <ReportCard
          key={r.id}
          report={r}
          onDismiss={async (id) => { await actions.dismiss(id); refresh(); }}
          onHide={async (imageId) => { await actions.hide(imageId); refresh(); }}
          onDelete={async (imageId) => { await actions.deleteImg(imageId); refresh(); }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement the page**

```typescript
// app/admin/reports/page.tsx
import { Suspense } from 'react';
import { getPendingReports, getPendingCount } from '@/lib/queries/reports';
import { dismissReport } from '@/actions/dismissReport';
import { hideImage } from '@/actions/hideImage';
import { deleteImage } from '@/actions/deleteImage';
import { ReportListClient } from './_actions';

export default async function AdminReportsPage() {
  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <h1>reports</h1>
        <Suspense fallback={<span>…</span>}><PendingCount /></Suspense>
      </header>
      <Suspense fallback={<p>loading…</p>}>
        <Inner />
      </Suspense>
    </main>
  );
}

async function PendingCount() {
  const n = await getPendingCount();
  return <span className="admin-page-count">{n} pending</span>;
}

async function Inner() {
  const reports = await getPendingReports();
  return (
    <ReportListClient
      reports={reports}
      actions={{
        dismiss: dismissReport,
        hide: hideImage,
        deleteImg: deleteImage,
      }}
    />
  );
}
```

- [ ] **Step 3: Sanity boot**

```bash
npm run dev
```

Open `http://localhost:3000/admin/reports`, enter `admin:dev-pass` at the auth prompt.
Expected: empty state visible (or pending reports if any have been seeded).

- [ ] **Step 4: Commit**

```bash
git add app/admin/reports/page.tsx app/admin/reports/_actions.ts
git commit -m "feat(p4): /admin/reports page with three card actions"
```

---

## Task 23: Admin + report + modal styles

**Files:** Modify `app/globals.css`

- [ ] **Step 1: Append**

```css
/* app/globals.css — append */

/* Modal */
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(13,12,16,0.65);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.modal-dialog {
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--r3);
  max-width: 560px;
  width: calc(100vw - 32px);
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 12px 48px rgba(0,0,0,0.6);
}

/* Report form */
.report-form {
  padding: var(--s4);
  display: flex; flex-direction: column; gap: var(--s3);
}
.report-form h2 { margin: 0; font-family: var(--font-display); }
.report-form-help { margin: 0; color: var(--text-7); font-size: 0.9rem; }
.report-category-chips { display: flex; flex-wrap: wrap; gap: var(--s1); }
.report-form textarea {
  width: 100%;
  background: var(--bg-sunken);
  color: var(--text-92);
  border: 1px solid var(--border-default);
  border-radius: var(--r2);
  padding: var(--s2);
  font-family: var(--font-sans);
  resize: vertical;
}
.report-form-error { color: var(--accent); margin: 0; font-size: 0.9rem; }
.report-form-actions { display: flex; justify-content: flex-end; gap: var(--s2); }
.report-form-actions button {
  border: 1px solid var(--border-default);
  background: var(--bg-sunken);
  color: var(--text-92);
  padding: var(--s2) var(--s4);
  border-radius: var(--r3);
  cursor: pointer;
  transition: all var(--t-base);
}
.report-form-actions button:last-child {
  background: var(--accent);
  color: var(--bg-base);
  border-color: var(--accent);
}
.report-form-actions button:disabled { opacity: 0.45; cursor: not-allowed; }

/* Report modal preview */
.report-modal-content { display: flex; gap: var(--s4); padding: var(--s4); }
.report-modal-preview img { width: 160px; height: 160px; object-fit: cover; border-radius: var(--r2); }
.report-modal-preview .preview-name { margin: var(--s1) 0 0 0; font-size: 0.85rem; color: var(--text-7); }

/* Full-page report fallback */
.report-page { max-width: 720px; margin: 0 auto; padding: var(--s4); }
.report-page-header { margin-bottom: var(--s3); }
.report-page-back { color: var(--text-7); text-decoration: none; }
.report-page-content { display: flex; flex-direction: column; gap: var(--s4); }
.report-page-preview img { width: 100%; max-width: 320px; border-radius: var(--r3); }

/* Toast */
.toast-host {
  position: fixed;
  bottom: var(--s4);
  right: var(--s4);
  display: flex; flex-direction: column; gap: var(--s2);
  z-index: 2000;
  pointer-events: none;
}
.toast {
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--r3);
  padding: var(--s2) var(--s3);
  color: var(--text-92);
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  animation: toast-in 0.2s ease-out;
}
@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Admin */
.admin-page { max-width: 1100px; margin: 0 auto; padding: var(--s4); }
.admin-page-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: var(--s4); }
.admin-page-header h1 { font-family: var(--font-display); margin: 0; }
.admin-page-count { font-family: var(--font-mono); color: var(--text-7); }
.admin-empty { text-align: center; color: var(--text-7); padding: var(--s8) 0; }

.report-list { display: flex; flex-direction: column; gap: var(--s3); }
.report-card {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--s3);
  background: var(--bg-sunken);
  border: 1px solid var(--border-default);
  border-radius: var(--r3);
  padding: var(--s3);
}
.report-card-thumb { position: relative; }
.report-card-thumb img { width: 120px; height: 120px; object-fit: cover; border-radius: var(--r2); display: block; }
.report-card-stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; border-radius: var(--r2) 0 0 var(--r2); }
.report-card-body { display: flex; flex-direction: column; gap: var(--s1); }
.report-card-header { display: flex; justify-content: space-between; align-items: baseline; }
.report-card-category {
  font-family: var(--font-mono);
  text-transform: uppercase;
  font-size: 0.8rem;
  color: var(--accent);
  letter-spacing: 0.04em;
}
.report-card-age { font-family: var(--font-mono); color: var(--text-55); font-size: 0.8rem; }
.report-card-name { font-family: var(--font-sans); font-size: 1.1rem; color: var(--text-92); margin: 0; }
.report-card-meta { font-family: var(--font-mono); font-size: 0.85rem; color: var(--text-7); margin: 0; }
.report-card-id { color: var(--text-55); }
.report-card-source-link { color: var(--accent); text-decoration: none; }
.report-card-message {
  margin: var(--s2) 0;
  padding: var(--s2) var(--s3);
  border-left: 3px solid var(--accent);
  background: var(--bg-base);
  border-radius: 0 var(--r2) var(--r2) 0;
  font-style: italic;
  color: var(--text-7);
}
.report-card-warning { color: var(--accent); font-size: 0.85rem; margin: 0; }
.report-card-actions { display: flex; gap: var(--s2); margin-top: var(--s2); }
.report-card-actions button,
.btn-destructive,
.btn-destructive-idle {
  border: 1px solid var(--border-default);
  background: var(--bg-elevated);
  color: var(--text-92);
  padding: var(--s1) var(--s3);
  border-radius: var(--r2);
  font-family: var(--font-sans);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all var(--t-base);
}
.btn-destructive-idle:hover { border-color: var(--accent); color: var(--accent); }
.btn-destructive { background: var(--accent); border-color: var(--accent); color: var(--bg-base); }
.btn-armed { animation: armed-pulse 0.6s ease-in-out infinite alternate; }
@keyframes armed-pulse {
  from { box-shadow: 0 0 0 0 rgba(255,110,199,0.4); }
  to { box-shadow: 0 0 0 6px rgba(255,110,199,0); }
}
```

- [ ] **Step 2: Visual sanity check**

```bash
npm run dev
```

Visit `/report/<any-existing-image-id>` and `/admin/reports`. Confirm:
- Report form chips render
- "other" reveals textarea
- Admin page header + cards look sane

Kill dev server.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(p4): modal + report form + toast + admin styles"
```

---

## Task 24: e2e — report modal flow

**Files:** Create `tests/e2e/report-modal.spec.ts`

- [ ] **Step 1: Write the e2e test**

```typescript
// tests/e2e/report-modal.spec.ts
import { test, expect } from '@playwright/test';

test('R key opens report modal during session, Esc closes it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /start session/i }).click();
  await page.waitForURL(/\/session\?session=/);
  await page.waitForSelector('img');

  await page.keyboard.press('r');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: /^submit$/i })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('reporting an image removes it from gallery', async ({ page }) => {
  await page.goto('/gallery');
  await page.waitForSelector('.grid-item');
  const firstTile = page.locator('.grid-item').first();
  const imageId = await firstTile.getAttribute('data-id');
  expect(imageId).toBeTruthy();

  await page.goto(`/report/${imageId}`);
  await page.getByRole('button', { name: /^spooky$/i }).click();
  await page.getByRole('button', { name: /^submit$/i }).click();

  await page.waitForURL('/');

  await page.goto('/gallery');
  await page.waitForSelector('.grid-item');
  await expect(page.locator(`[data-id="${imageId}"]`)).toHaveCount(0);
});

test('full-page /report/[id] form submits successfully', async ({ page }) => {
  await page.goto('/gallery');
  await page.waitForSelector('.grid-item');
  const imageId = await page.locator('.grid-item').first().getAttribute('data-id');

  await page.goto(`/report/${imageId}`);
  await expect(page.getByText(/^report this image$/i)).toBeVisible();
  await page.getByRole('button', { name: /low-resolution/i }).click();
  await page.getByRole('button', { name: /^submit$/i }).click();
  await page.waitForURL('/');
});
```

- [ ] **Step 2: Run the test**

Run: `npx playwright test tests/e2e/report-modal.spec.ts`
Expected: PASS (3). Test 2 mutates state — make sure to reseed before running other dependent tests, or run in CI with a fresh DB.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/report-modal.spec.ts
git commit -m "test(p4): e2e — report modal + gallery hide-on-report"
```

---

## Task 25: e2e — admin auth gate

**Files:** Create `tests/e2e/admin-auth.spec.ts`

- [ ] **Step 1: Write the e2e test**

```typescript
// tests/e2e/admin-auth.spec.ts
import { test, expect, request as pwRequest } from '@playwright/test';

test('GET /admin/reports without auth returns 401', async () => {
  const api = await pwRequest.newContext({ baseURL: 'http://localhost:3000' });
  const res = await api.get('/admin/reports');
  expect(res.status()).toBe(401);
  expect(res.headers()['www-authenticate']).toContain('Basic');
});

test('GET /admin/reports with wrong credentials returns 401', async () => {
  const api = await pwRequest.newContext({
    baseURL: 'http://localhost:3000',
    httpCredentials: { username: 'admin', password: 'wrong' },
  });
  const res = await api.get('/admin/reports');
  expect(res.status()).toBe(401);
});

test('GET /admin/reports with valid credentials returns 200', async () => {
  const api = await pwRequest.newContext({
    baseURL: 'http://localhost:3000',
    httpCredentials: { username: 'admin', password: process.env.ADMIN_DEV_PASS ?? 'dev-pass' },
  });
  const res = await api.get('/admin/reports');
  expect(res.status()).toBe(200);
});

test('no nav link to /admin exists from public pages', async ({ page }) => {
  await page.goto('/');
  expect(await page.locator('a[href*="/admin"]').count()).toBe(0);
  await page.goto('/gallery');
  expect(await page.locator('a[href*="/admin"]').count()).toBe(0);
});

test('robots.txt disallows /admin', async ({ page }) => {
  await page.goto('/robots.txt');
  const text = await page.textContent('body');
  expect(text).toContain('Disallow: /admin/');
});
```

- [ ] **Step 2: Run the test**

Run: `npx playwright test tests/e2e/admin-auth.spec.ts`
Expected: PASS (5). Requires the dev `ADMIN_PASSWORD_HASH` to match `dev-pass`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/admin-auth.spec.ts
git commit -m "test(p4): e2e — admin Basic Auth + robots + no-public-link"
```

---

## Task 26: e2e — admin resolve actions

**Files:** Create `tests/e2e/admin-resolve.spec.ts`

- [ ] **Step 1: Write the e2e test**

```typescript
// tests/e2e/admin-resolve.spec.ts
import { test, expect } from '@playwright/test';

test.use({ httpCredentials: { username: 'admin', password: process.env.ADMIN_DEV_PASS ?? 'dev-pass' } });

async function seedReport(page: any): Promise<string> {
  await page.goto('/gallery');
  await page.waitForSelector('.grid-item');
  const imageId = (await page.locator('.grid-item').first().getAttribute('data-id'))!;
  await page.goto(`/report/${imageId}`);
  await page.getByRole('button', { name: /^cropped$/i }).click();
  await page.getByRole('button', { name: /^submit$/i }).click();
  await page.waitForURL('/');
  return imageId;
}

test('Dismiss removes the card and re-shows the image in gallery', async ({ page }) => {
  const imageId = await seedReport(page);
  await page.goto('/admin/reports');
  const card = page.locator('.report-card', { hasText: imageId });
  await card.getByRole('button', { name: /^dismiss$/i }).click();
  await expect(card).toHaveCount(0, { timeout: 5000 });

  await page.goto('/gallery');
  await expect(page.locator(`[data-id="${imageId}"]`)).toHaveCount(1);
});

test('Hide image keeps the image absent from gallery', async ({ page }) => {
  const imageId = await seedReport(page);
  await page.goto('/admin/reports');
  const card = page.locator('.report-card', { hasText: imageId });
  await card.getByRole('button', { name: /^hide image$/i }).click();
  await expect(card).toHaveCount(0);

  await page.goto('/gallery');
  await expect(page.locator(`[data-id="${imageId}"]`)).toHaveCount(0);
});

test('Delete needs two clicks; image vanishes from /api/thumb', async ({ page }) => {
  const imageId = await seedReport(page);
  await page.goto('/admin/reports');
  const card = page.locator('.report-card', { hasText: imageId });

  await card.getByRole('button', { name: /^delete$/i }).click();
  await expect(card.getByRole('button', { name: /are you sure/i })).toBeVisible();
  await card.getByRole('button', { name: /are you sure/i }).click();
  await expect(card).toHaveCount(0);

  await page.goto('/gallery');
  await expect(page.locator(`[data-id="${imageId}"]`)).toHaveCount(0);
});
```

- [ ] **Step 2: Run the test**

Run: `npx playwright test tests/e2e/admin-resolve.spec.ts`
Expected: PASS (3). These mutate state — reseed before re-runs.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/admin-resolve.spec.ts
git commit -m "test(p4): e2e — admin Dismiss/Hide/Delete actions"
```

---

## Task 27: README runbook (admin password setup)

**Files:** Modify or create `README.md`

- [ ] **Step 1: Add an Admin section**

```markdown
## Admin

The `/admin/reports` view is gated by HTTP Basic Auth. There is no signup or login UI.

### First-time setup

Generate a bcrypt hash for your password and add it to `.env.local`:

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" your-password
```

Add to `.env.local`:

```
ADMIN_PASSWORD_HASH=$2a$10$....
```

Restart the dev server. Visit `/admin/reports` and enter `admin` + your password at the browser prompt.

### Actions

- **Dismiss** — leaves the image visible to students; closes the report.
- **Hide image** — flips `images.hidden=true`; image vanishes from gallery and sessions until un-hidden manually in the DB.
- **Delete** — destructive. Removes DB row + on-disk files. Two-click confirmation.

All actions invalidate cache tags listed in `actions/_invalidation.ts`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(p4): README admin setup + action behavior"
```

---

## Task 28: Full test suite + type check

- [ ] **Step 1: Vitest full run**

Run: `npx vitest run`
Expected: ALL unit tests pass.

- [ ] **Step 2: Playwright full run**

Run: `npx playwright test`
Expected: ALL e2e suites pass. Some report-related tests mutate state — re-seed if you want clean re-runs.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Production build smoke**

Run: `npm run build && npm run start`
In another shell:

```bash
curl -sI http://localhost:3000/                                   # 200
curl -sI http://localhost:3000/gallery                            # 200
curl -sI http://localhost:3000/admin/reports                      # 401
curl -sI -u admin:dev-pass http://localhost:3000/admin/reports    # 200
```

Kill the prod server.

- [ ] **Step 5: Commit any incidental fixes**

```bash
git status
# If anything changed:
git add -A && git commit -m "chore(p4): stabilize full test suite"
```

---

## Plan complete

After Task 28 the moderation flow is fully wired end-to-end. The full app is now production-ready:
- Home → Session player with timer/audio/keyboard
- Gallery with FTS5 species autocomplete + filters + hover-zoom + lazy loading
- Reports submit anonymously via intercepting modal, auto-hide reported images
- Admin reports page at hidden URL with Dismiss / Hide / Delete actions
- All admin mutations re-verify Basic Auth + invalidate the right cache tags
- 5K-row dataset, three image tiers, immutable caching, Cache Components

Suggested next steps after P4 (out of MVP scope):
- ANALYZE in seed (already present per P0)
- Polish animations, observe production latency
- Sketchfab integration when ready (notes in `docs/sketchfab-notes.md`)
