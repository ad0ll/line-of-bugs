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
  // Full-bleed page-tinted overlay (matches .modal-backdrop). Use for
  // top-level overlays where the page color should still tint through.
  surfaceBackdrop: "rgba(13, 12, 16, 0.65)",
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
  textDanger: "#ef4444",

  // ── Borders ──
  borderSubtle: "rgba(255, 255, 255, 0.07)",
  borderMedium: "rgba(255, 255, 255, 0.1)",
  borderEmphasis: "rgba(255, 255, 255, 0.2)",
  borderDanger: "rgba(239, 68, 68, 0.5)",

  // ── Accents — Pastel Goth Kawaii primary trio + danger ──
  accentPink: "#FF6EC7",      // Coleoptera color, doubles as primary brand
  accentLilac: "#A78BFA",     // Diptera color, secondary brand
  accentSky: "#67D4E6",       // Odonata color, tertiary brand
  accentDanger: "#ef4444",    // Destructive actions only
  accentPinkSoft: "rgba(255, 110, 199, 0.18)",
  accentPinkBorder: "rgba(255, 110, 199, 0.55)",

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
