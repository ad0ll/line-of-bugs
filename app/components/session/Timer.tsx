"use client";

interface Props {
  remainingMs: number;
  paused: boolean;
  /** When true, a 🔇 glyph is appended to the timer pill so users always
   *  see at a glance whether audio cues will fire. Persisted via useMuted. */
  muted?: boolean;
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(total / 60).toString().padStart(2, "0");
  const ss = (total % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

// SR announcement thresholds mirror SessionPlayer's audio-cue thresholds
// (30s ding, 10s ding, 3-2-1 countdown) so screen-reader users hear the
// same warning cadence without per-second chatter.
const ANNOUNCE_AT = new Set([30, 10, 3, 2, 1]);

function announce(seconds: number): string {
  if (seconds === 0) return "time's up";
  if (ANNOUNCE_AT.has(seconds)) return `${seconds} seconds remaining`;
  return "";
}

export function Timer({ remainingMs, paused, muted = false }: Props) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const announcement = announce(seconds);
  return (
    <>
      <div
        className="session-timer"
        style={{ opacity: paused ? 0.55 : 1 }}
        data-testid="session-timer"
      >
        {paused && <span aria-hidden className="session-timer-paused-icon">⏸</span>}
        {fmt(remainingMs)}
        {muted && <span aria-hidden className="session-timer-muted-icon">⊘</span>}
      </div>
      {announcement ? (
        <span className="u-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </span>
      ) : null}
    </>
  );
}
