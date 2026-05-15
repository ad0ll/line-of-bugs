"use client";

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
  // Why polite not assertive: assertive would interrupt screen-reader narration
  // of the image alt text on every tick.
  return (
    <div
      className="session-timer"
      style={{ opacity: paused ? 0.55 : 1 }}
      aria-live="polite"
      aria-atomic="true"
      aria-label="time remaining"
    >
      {fmt(remainingMs)}
    </div>
  );
}
