import { describe, it, expect } from "vitest";
import { T } from "@/lib/tokens";

describe("design tokens", () => {
  it("exposes the surface-0 base color", () => {
    expect(T.surface0).toBe("#0d0c10");
  });

  it("exposes text alpha ladder", () => {
    expect(T.textPrimary).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.92\)/);
    expect(T.textSecondary).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.7\)/);
    // Tertiary was bumped from 0.55 → 0.62 in the 2026-05-16 contrast audit
    // (5.7:1 → 6.3:1 on --surface-0).
    expect(T.textTertiary).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.62\)/);
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
