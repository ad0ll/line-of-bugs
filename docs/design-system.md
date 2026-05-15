# line-of-bugs design system

A short, opinionated guide to the visual language. Read this before adding UI.

## The single most important thing

**The bug photo is the product.** Everything else is metadata or chrome and should fade behind it. If a UI element competes with the photo for attention, it's wrong.

## Color hierarchy (3 accents + neutrals)

We have a **Pastel Goth Kawaii** palette. Each accent has ONE semantic job. Mixing jobs creates the "everything is pink" muddle.

| Token | Hex | Job | Where it shows up |
|---|---|---|---|
| `--accent-pink` | `#FF6EC7` | **Primary action + brand** | Page-title wordmark, start-session button, selected filter chip, focus ring, submit button |
| `--accent-lilac` | `#A78BFA` | **Structure** | Section headings (`✿ interval per slide`), card borders on the selected state, decorative title accent |
| `--accent-sky` | `#67D4E6` | **Link / external / metadata** | "source ↗" links, "X/N" collection badge tint, hover-zoom popup ring (subtle), gallery autocomplete focus ring |
| `--accent-danger` | `#ef4444` | **Destructive only** | Delete button (armed state), error messages |

**Neutrals** are the white-alpha ladder: 92 / 70 / 55 / 30. Don't mix in colored grays.

## Text hierarchy

Three fonts, three jobs. Don't reach for a fourth.

| Use | Font | Style |
|---|---|---|
| Page titles, section headings, distinctive labels | **Fraunces** | italic, weight 500 |
| UI body, button labels, common names | **Zen Maru Gothic** | regular/medium |
| Numbers, IDs, badges, code-like data | **JetBrains Mono** | regular |

**Scale (when you reach for a size, find the nearest one in this scale first):**

| Token | px | Use |
|---|---|---|
| `--text-xs` | 11 | hints (`B`, `SPACE`), keyboard shortcuts, image IDs |
| `--text-sm` | 13 | secondary captions, mono badges |
| `--text-md` | 14 | UI body |
| `--text-base` | 15 | button labels, common name |
| `--text-lg` | 16 | session title chip |
| `--text-xl` | 20 | report modal heading |
| `--text-2xl` | 26 | gallery page heading |
| `--text-3xl` | 32 | end-of-session overlay heading |
| `--text-display` | 56-72 | home wordmark |

## Spacing & rhythm

4px grid. Use the `--s*` tokens. Never write raw pixel values for margins/padding.

## Surfaces

| Token | When |
|---|---|
| `--surface-0` (`#0d0c10`) | App canvas |
| `--surface-1` (`#16141a`) | Cards, popovers, inputs |
| `--surface-2` (`#201e24`) | Hover on cards, modal dialog, secondary buttons |
| `--surface-chip` (10/.55) | Floating chips over images |
| `--surface-chip-strong` (10/.78) | Same but more opaque (session title, source info) |

## Component patterns

### Filter / option pill (`.chip`)
- Idle: surface-1 background, border-medium 1.5px, text-secondary
- Active: **solid accent-pink fill** + dark text (`--text-on-accent`)
- Use this ONE class for: gallery filters, home interval picker, home subject filter, report category chips

### Radio card (`.home-radio-card`)
- Used for multi-option pickers with hints (repeat-mode toggle)
- Selected: lilac-accented border + pink-lilac gradient soft background

### Primary CTA (`.home-start`)
- Solid pink pill, dark text, soft pink glow
- Use sparingly: only for the one most important action on a screen

### Destructive button (`.btn-destructive-idle` → `.btn-destructive.btn-armed`)
- Idle: surface-2 background, border-medium → red hover
- Armed: solid red fill, pulsing red glow
- Never use pink for destructive — that's a brand-bug.

## Gallery info hierarchy (top → bottom on each tile)

1. **Photo** (the most important thing — fills the tile)
2. **Common name** (sans, 14px, primary text — what students recognize)
3. **Scientific name** (display italic, 13px, tertiary text — secondary, optional)
4. **Order badge** (mono, 11px, colored outline — for the curious, smallest)

`Collection X/N` badge sits as a small mono chip in the top-right of the photo (only when N > 1). External-source affordance ("click to view at iNaturalist") is implicit via the whole-tile being a link.

## Session player info hierarchy

The active drawing surface is essentially a museum — minimal chrome, photo dominates.

**Always visible (low-distraction):**
- **Photo** (full bleed, contain-fit)
- **Bug name** top-left chip (display italic, 16px, surface-chip-strong)
- **Timer** top-right (mono 24px, tabular-nums)
- **Progress bar** along the very top edge (4px pink fill)

**Visible only on user activity (auto-hides 2s after last mousemove):**
- **Action bar** centered bottom: pause / timer / B&W / magnifier / zoom / fullscreen / report / source / counter
- **Source info chip** bottom-right: order badge + scientific name + photographer + institution
- **Edge prev/next** arrows along left/right edges

## Things to avoid

- **Gradient text** as a "look fancy" move. Use solid color + a distinctive font.
- **Emoji icons** mixed with monoline glyphs. Commit to one icon system per surface.
- **Pink everywhere.** If three things on the same surface are all pink, the user can't tell which one is the primary action. Spread accents per the table above.
- **Different class systems for the same primitive.** All pill-shaped buttons are `.chip`; all radio-card-style selectors are `.home-radio-card`. Don't fork.
- **Magic numbers.** Use `--s*`, `--r-*`, `--text-*`. Drift starts the moment someone writes `padding: 7px 13px`.

---
