# Design Pass v2 — Phase B: Session Player Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the session player action bar a unified grid, restyle the source button to match the rest, collapse order-only iNaturalist IDs in the title, and verify image loading is preload-aware so users never see a blank frame between slides.

**Architecture:** Surgical edits to existing components — no new components, no API changes. Pure visual + interaction polish.

**Tech Stack:** Next.js 16, React 19, TypeScript, existing `SessionActionBar` / `SessionTitle` / preload manager.

**Spec:** `docs/superpowers/specs/2026-05-16-design-pass-v2-design.md` (sections "Session player polish" + "Image loading strategy")

---

## File Structure

**Modified**
- `app/components/session/SessionActionBar.tsx` — equal-width buttons, source button restyle
- `app/components/session/SessionTitle.tsx` — order-only-ID collapse logic
- `app/globals.css` — action-bar grid sizing, counter slot, source button styles
- `lib/text-format.ts` — add `isOrderOnlyId` helper (or inline if too small)
- `tests/components/SessionActionBar.test.tsx` — equal-width assertion, source-restyle assertion
- `tests/components/SessionTitle.test.tsx` — order-only-ID handling test

**Verified (no changes expected)**
- `app/components/session/Magnifier.tsx` — already cover-aware, no edits
- `lib/preload-manager.ts` — confirm prev-1 + next-3 preload behavior

---

## Task 1: Order-only-ID title collapse helper

**Files:**
- Create: `lib/text-format.ts` (helper, additive — file may already exist)
- Test: `tests/lib/text-format.test.ts`

- [ ] **Step 1: Write failing tests for `isOrderOnlyId`**

If `tests/lib/text-format.test.ts` exists, append to it. Otherwise create:

```ts
import { describe, it, expect } from "vitest";
import { isOrderOnlyId } from "@/lib/text-format";

describe("isOrderOnlyId", () => {
  it("true when common name equals taxon order (case-insensitive)", () => {
    expect(isOrderOnlyId("butterflies, moths or skippers", "Lepidoptera", "Lepidoptera")).toBe(true);
    expect(isOrderOnlyId("Lepidoptera", "Lepidoptera", "Lepidoptera")).toBe(true);
    expect(isOrderOnlyId("Wasps, Bees, Ants and Sawflies", "Hymenoptera", "Hymenoptera")).toBe(true);
  });

  it("false when species is more specific than the order", () => {
    expect(isOrderOnlyId("Monarch", "Danaus plexippus", "Lepidoptera")).toBe(false);
    expect(isOrderOnlyId("Asian Longhorned Beetle", "Anoplophora glabripennis", "Coleoptera")).toBe(false);
  });

  it("false when species or order is missing", () => {
    expect(isOrderOnlyId(null, "Lepidoptera", "Lepidoptera")).toBe(false);
    expect(isOrderOnlyId("Lepidoptera", null, "Lepidoptera")).toBe(false);
    expect(isOrderOnlyId("Lepidoptera", "Lepidoptera", null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/text-format.test.ts`
Expected: FAIL — `isOrderOnlyId` not exported.

- [ ] **Step 3: Add the helper**

If `lib/text-format.ts` exists, append. Otherwise create with the appended function. The simplest case:

```ts
/**
 * iNaturalist observations identified only to the order level surface with
 * `taxon_species` == `taxon_order` (e.g., both "Lepidoptera"). The common
 * name in that case is the order's common name ("Butterflies, Moths or
 * Skippers"). Detecting this lets the UI collapse a 3-way duplicate
 * (common, scientific, chip) into a single display with an "(order)" hint.
 */
export function isOrderOnlyId(
  commonName: string | null | undefined,
  taxonSpecies: string | null | undefined,
  taxonOrder: string | null | undefined,
): boolean {
  if (!taxonSpecies || !taxonOrder) return false;
  return taxonSpecies.toLowerCase() === taxonOrder.toLowerCase();
}
```

(The `commonName` argument is currently unused — kept in the signature so callers can pass it without thinking, and so a future refinement (e.g., also checking commonName matches a known list of order common names) doesn't change the call site.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/text-format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/text-format.ts tests/lib/text-format.test.ts
git commit --no-gpg-sign -m "feat(text-format): isOrderOnlyId helper for iNat order-level IDs

When iNat identifies only to the order level, taxon_species equals
taxon_order. Detecting that lets UI collapse the 3-way duplicate
(common name / scientific / chip) into one display."
```

---

## Task 2: SessionTitle uses the helper

**Files:**
- Modify: `app/components/session/SessionTitle.tsx`
- Test: `tests/components/SessionTitle.test.tsx` (existing — may need new cases)

- [ ] **Step 1: Read current SessionTitle to understand its structure**

Read `app/components/session/SessionTitle.tsx`. It currently renders something like:

```tsx
<h2 className="session-title">
  <span className="session-title-common">{titleCaseCommonName(commonName ?? "...")}</span>
  <span className="session-title-sci">{taxonSpecies}</span>
</h2>
```

- [ ] **Step 2: Write a failing test for the collapse behavior**

Add (or extend) `tests/components/SessionTitle.test.tsx`:

```tsx
it("collapses to one display when common name = order (order-only iNat ID)", async () => {
  const image = {
    imageId: "test-id",
    commonName: "butterflies, moths or skippers",
    taxonSpecies: "Lepidoptera",
    taxonOrder: "Lepidoptera",
  };
  const screen = await render(<SessionTitle image={image as any} />);
  // Common name shows, with "(order)" annotation
  await expect.element(screen.getByText(/Butterflies, Moths Or Skippers/i)).toBeInTheDocument();
  await expect.element(screen.getByText(/\(order\)/i)).toBeInTheDocument();
  // Scientific italic should NOT appear separately when it would duplicate
  const sciNodes = screen.container().querySelectorAll(".session-title-sci");
  expect(sciNodes.length).toBe(0);
});

it("shows both common + scientific when species is more specific", async () => {
  const image = {
    imageId: "test-id",
    commonName: "monarch",
    taxonSpecies: "Danaus plexippus",
    taxonOrder: "Lepidoptera",
  };
  const screen = await render(<SessionTitle image={image as any} />);
  await expect.element(screen.getByText(/Monarch/i)).toBeInTheDocument();
  await expect.element(screen.getByText(/Danaus plexippus/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify the first test fails**

Run: `npx vitest run tests/components/SessionTitle.test.tsx`
Expected: FAIL on the collapse case (the existing component renders the scientific span regardless).

- [ ] **Step 4: Update SessionTitle**

Replace the relevant part of `SessionTitle.tsx`. Pattern:

```tsx
import { isOrderOnlyId } from "@/lib/text-format";
import { titleCaseCommonName } from "@/lib/text-format"; // if same file
// ... existing imports

export function SessionTitle({ image }: { image: Image }) {
  const orderOnly = isOrderOnlyId(image.commonName, image.taxonSpecies, image.taxonOrder);
  const display = image.commonName ? titleCaseCommonName(image.commonName) : (image.taxonSpecies ?? "");
  return (
    <h2 className="session-title">
      <span className="session-title-common">{display}</span>
      {orderOnly ? (
        <span className="session-title-order-hint">(order)</span>
      ) : image.taxonSpecies ? (
        <span className="session-title-sci">{image.taxonSpecies}</span>
      ) : null}
    </h2>
  );
}
```

(Adapt to the actual existing imports / prop names in your file — preserve existing classes.)

- [ ] **Step 5: Add styling for the new hint span**

Append to `app/globals.css`:

```css
.session-title-order-hint {
  font-style: italic;
  font-size: 0.8em;
  opacity: 0.65;
  margin-left: 0.4rem;
  letter-spacing: 0.02em;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/components/SessionTitle.test.tsx`
Expected: PASS (both cases)

- [ ] **Step 7: Commit**

```bash
git add app/components/session/SessionTitle.tsx app/globals.css tests/components/SessionTitle.test.tsx
git commit --no-gpg-sign -m "feat(session): collapse order-only iNat IDs in title

When common_name == taxon_order (iNat low-confidence ID), show just the
common name with a small '(order)' hint instead of duplicating the
scientific line that would say the same thing."
```

---

## Task 3: SessionActionBar — equal-width buttons + source restyle

**Files:**
- Modify: `app/components/session/SessionActionBar.tsx`
- Modify: `app/globals.css`
- Modify: `tests/components/SessionActionBar.test.tsx`

- [ ] **Step 1: Read current SessionActionBar + its IconBtn usage**

Inspect `app/components/session/SessionActionBar.tsx` and `app/components/ui/IconBtn.tsx`. The action bar today renders 6 button-stack + 1 anchor-as-IconBtn for source + a counter span. Goal:
- All seven elements have identical `min-width` (the wider of "fullscreen" or "magnifier" label).
- Counter sits in the same vertical rhythm slot to the right of source.

- [ ] **Step 2: Add a failing test**

Append to `tests/components/SessionActionBar.test.tsx`:

```tsx
it("action bar buttons (including source) share a min-width", async () => {
  const props = baseProps();
  const screen = await render(<SessionActionBar {...props} />);
  const buttons = screen.container().querySelectorAll(
    ".session-action-bar-panel button.u-icon-btn-stacked, .session-action-bar-panel a.u-icon-btn-stacked",
  );
  expect(buttons.length).toBeGreaterThanOrEqual(7);
  const widths = Array.from(buttons).map(
    (b) => (b as HTMLElement).getBoundingClientRect().width,
  );
  const max = Math.max(...widths);
  const min = Math.min(...widths);
  expect(max - min).toBeLessThanOrEqual(1.5); // sub-pixel rounding tolerance
});

it("source button is not underlined and shares the stacked layout", async () => {
  const props = baseProps();
  const screen = await render(<SessionActionBar {...props} />);
  const source = screen.container().querySelector(".session-action-bar-panel a.u-icon-btn-stacked")! as HTMLElement;
  expect(source.tagName.toLowerCase()).toBe("a");
  // No underline
  const td = getComputedStyle(source).textDecorationLine;
  expect(td).toBe("none");
});
```

(`baseProps()` should already exist or be inline-defined per the existing test file.)

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/components/SessionActionBar.test.tsx`
Expected: FAIL on the equal-width test (current bar has variable widths) and possibly on the underline test depending on how the source link is styled.

- [ ] **Step 4: Apply CSS — equal-width slot + source restyle**

Append to `app/globals.css`:

```css
/* Phase B — uniform action bar slot. The widest label drives min-width
   so the bar reads as a grid, not a ragged row. 76px accommodates the
   "fullscreen" label at 0.7rem with comfortable side padding. */
.session-action-bar-panel .u-icon-btn-stacked {
  min-width: 76px;
  text-decoration: none;
}
.session-action-bar-panel .u-icon-btn-stacked:hover,
.session-action-bar-panel .u-icon-btn-stacked:focus-visible {
  text-decoration: none;
}
/* Counter sits in the same rhythm as the stacked buttons. */
.session-action-bar-panel .session-counter {
  min-width: 76px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 5: Verify the SessionActionBar code already renders the counter inside the panel**

Read `SessionActionBar.tsx`. If the counter (`<span class="session-counter">…</span>`) is already inside the `.session-action-bar-panel` container, no JSX change needed. If not, move it inside so the min-width selector applies.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/components/SessionActionBar.test.tsx`
Expected: PASS

- [ ] **Step 7: Visual verification via playwright MCP**

Start a session (POST /api/session/start, then navigate to /session?session=…&interval=60). Trigger chrome by mouse-moving inside the player. Screenshot the action bar. Confirm:
- 7 items same width
- Source button looks identical to other stacked icons (no underline, no link-blue)
- Counter centered in its slot

If the visual doesn't match, iterate the CSS before committing.

- [ ] **Step 8: Commit**

```bash
git add app/components/session/SessionActionBar.tsx app/globals.css tests/components/SessionActionBar.test.tsx
git commit --no-gpg-sign -m "feat(session): uniform action-bar grid + source restyle

All 7 controls (pause/timer/b.w/magnifier/fullscreen/report/source) and
the counter share min-width 76px so the bar reads as a grid. Source link
loses its link-blue + underline; visually identical to the other stacked
icon buttons."
```

---

## Task 4: Image loading audit — confirm preload window + medium tier

**Files:**
- Verify: `lib/preload-manager.ts`
- Verify: `app/components/session/SessionImage.tsx`
- Verify: `app/api/medium/[name]/route.ts` cache headers
- No code changes expected unless gaps surface

- [ ] **Step 1: Read the preload manager**

Read `lib/preload-manager.ts`. Confirm:
- It accepts a queue of image IDs
- On `onIndexChange(i)`, it preloads next 3 (`i+1`, `i+2`, `i+3`) and previous 1 (`i-1`)
- Preloads are issued via `new Image()` or `<link rel="preload">` (either is fine — verify which)

If the window is different (e.g., next-2 only), expand to next-3 + previous-1 per the spec.

- [ ] **Step 2: Read SessionImage**

Read `app/components/session/SessionImage.tsx`. Confirm it uses the medium tier (`/api/medium/<name>`), not full-res (`/api/img/`). If it still uses full-res, switch the `src` to `/api/medium/${filename}` (the file name doesn't change between tiers; only the route prefix does).

If `next/image`'s `priority` is set for the current slide, leave it; otherwise add it.

- [ ] **Step 3: Verify `/api/medium/[name]` cache headers**

Read `app/api/medium/[name]/route.ts`. Confirm the response includes:
- `Cache-Control: public, max-age=31536000, immutable`
- `ETag` based on file stat

If missing, add them (mirror `/api/img/` and `/api/thumb/`).

- [ ] **Step 4: Live verification via curl**

Run:
```bash
curl -sI "http://localhost:3000/api/medium/$(sqlite3 /Users/adoll/projects/line-of-bugs/data/db/line-of-bugs.db 'SELECT filename FROM images WHERE hidden=0 LIMIT 1' | sed 's|^medium/||;s|^images/||')"
```

Confirm output includes `Cache-Control: public, max-age=31536000, immutable` and an `ETag`.

- [ ] **Step 5: Audit the preload behavior at runtime**

Start a session in the browser via playwright MCP, navigate prev/next a few times, and inspect Network panel via:

```ts
() => performance.getEntriesByType("resource")
  .filter(e => e.name.includes("/api/medium/"))
  .map(e => ({ name: e.name.split("/").pop(), start: Math.round(e.startTime), duration: Math.round(e.duration) }))
```

Confirm:
- Multiple `/api/medium/*` entries (preload window working)
- Current slide loads first (priority)
- Subsequent slides should already be cached when advanced

- [ ] **Step 6: If gaps found, fix them**

Most likely fix paths:
- `lib/preload-manager.ts` window adjusted
- `SessionImage.tsx` swapped to medium tier
- `/api/medium/[name]/route.ts` cache headers added

Each fix gets a TDD cycle (test → red → impl → green → commit). If no gaps, skip to Step 7.

- [ ] **Step 7: Commit (or note "no changes — verified")**

If changes were made:
```bash
git add <files>
git commit --no-gpg-sign -m "fix(session): image loading — medium tier + cache headers + preload window

Verified: preload manager fires next-3 + previous-1; SessionImage uses
medium tier (1024px); /api/medium has immutable + ETag headers. Brings
session prev/next navigation to instant after first slide."
```

If no changes:
```bash
# Make a one-line note in the spec or a NOTES file documenting the verification
echo "$(date -u +%Y-%m-%d) — Phase B Task 4: verified image loading already correct (medium tier + preload window + cache headers). No code changes needed." >> docs/superpowers/notes-design-pass-v2.md
git add docs/superpowers/notes-design-pass-v2.md
git commit --no-gpg-sign -m "docs(phase-b): verify image loading strategy — no changes needed"
```

---

## Task 5: E2E test — session player polish

**Files:**
- Create: `tests/e2e/session-polish.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/session-polish.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("session player polish (Phase B)", () => {
  async function startSession(page: import("@playwright/test").Page) {
    const res = await page.request.post("http://localhost:3000/api/session/start", {
      data: {
        intervalSec: 60, subjectType: "all", repeatMode: "default",
        views: [], lifeStages: [], sexes: [], groups: [], q: [],
      },
    });
    const json = await res.json();
    return json.sessionId as string;
  }

  test("action bar buttons share width", async ({ page }) => {
    const sessionId = await startSession(page);
    await page.goto(`/session?session=${sessionId}&interval=60`);
    // Bump chrome by mousemove
    await page.mouse.move(400, 400);
    await page.mouse.move(720, 450);
    const buttons = page.locator(".session-action-bar-panel .u-icon-btn-stacked");
    await expect(buttons.first()).toBeVisible();
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(7);
    const widths: number[] = [];
    for (let i = 0; i < count; i++) {
      const box = await buttons.nth(i).boundingBox();
      if (box) widths.push(box.width);
    }
    const max = Math.max(...widths);
    const min = Math.min(...widths);
    expect(max - min).toBeLessThanOrEqual(1.5);
  });

  test("source button is a link without underline", async ({ page }) => {
    const sessionId = await startSession(page);
    await page.goto(`/session?session=${sessionId}&interval=60`);
    await page.mouse.move(400, 400);
    await page.mouse.move(720, 450);
    const source = page.locator(".session-action-bar-panel a.u-icon-btn-stacked");
    await expect(source).toBeVisible();
    const td = await source.evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(td).toBe("none");
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test tests/e2e/session-polish.spec.ts --reporter=line`
Expected: PASS (2 tests)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/session-polish.spec.ts
git commit --no-gpg-sign -m "test(e2e): session polish — equal widths + source restyle"
```

---

## Final verification

- [ ] **Step 1: tsc + unit + e2e**

Run:
```bash
npx tsc --noEmit && npx vitest run --reporter=default && npx playwright test --reporter=line
```
Expected: all green.

- [ ] **Step 2: Visual MCP smoke**

Take a screenshot of the session player at 1440×900 with the action bar visible. Confirm:
- Uniform-width buttons
- Source no longer underlined
- Counter aligned with buttons
- Title block correctly collapses for an order-only-ID image

- [ ] **Step 3: Push (after user confirms)**

```bash
git push origin main
```
