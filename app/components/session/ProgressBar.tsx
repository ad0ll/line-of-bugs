"use client";
import { T } from "@/lib/tokens";

interface Props {
  percent: number; // 0..1
  playing: boolean;
}

export function ProgressBar({ percent, playing }: Props) {
  const clamped = Math.max(0, Math.min(1, percent));
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        background: T.surfaceProgressTrack,
        zIndex: 20,
      }}
    >
      <div
        data-testid="progress-fill"
        style={{
          height: "100%",
          width: "100%",
          background: T.accentPink,
          transformOrigin: "left center",
          transform: `scaleX(${clamped})`,
          transition: playing ? "transform 0.1s linear" : "",
        }}
      />
    </div>
  );
}
