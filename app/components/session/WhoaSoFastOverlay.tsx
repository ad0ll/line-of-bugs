"use client";
import { CuteFlower } from "@/app/components/icons";

/**
 * Phase F (2026-05-17) — shown when the ramp-up arrow-hold outpaces the
 * preload window. Spins a cute cherry blossom and reassures the user
 * with a no-exclamation-mark "whoa so fast". Auto-clears when the next
 * preload entry becomes ready.
 */
export function WhoaSoFastOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="session-whoa" role="status">
      <CuteFlower size={48} className="session-whoa-flower" />
      <span>whoa so fast</span>
    </div>
  );
}
