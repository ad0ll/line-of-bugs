"use client";
import { T } from "@/lib/tokens";

interface Props {
  remainingMs: number;
  paused: boolean;
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(total / 60).toString().padStart(2, "0");
  const ss = (total % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function Timer({ remainingMs, paused }: Props) {
  return (
    <div
      style={{
        position: "fixed",
        top: T.s8,
        right: T.s8,
        background: T.surfaceChip,
        border: `1px solid ${T.borderSubtle}`,
        borderRadius: T.r2xl,
        padding: `${T.s3}px ${T.s5}px`,
        fontFamily: "var(--font-mono), monospace",
        fontSize: T.text2xl,
        fontVariantNumeric: "tabular-nums",
        color: T.textPrimary,
        opacity: paused ? 0.55 : 1,
        transition: `opacity ${T.timingBase}`,
        zIndex: 30,
      }}
      aria-live="off"
    >
      {fmt(remainingMs)}
    </div>
  );
}
