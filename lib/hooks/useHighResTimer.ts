import { useRef, useEffect } from "react";

/**
 * High-resolution pauseable timer.
 * - `performance.now()` + `requestAnimationFrame` loop, 60 Hz onTick.
 * - `active` boolean controls pause/resume; accumulator preserves elapsed
 *   across pause cycles.
 * - `resetKey` change → reset accumulator and restart from 0.
 * - Pauses automatically when the tab is hidden (document.hidden true) and
 *   resumes when it becomes visible again. Without this, RAF throttling on
 *   background tabs causes elapsed-time drift.
 * - Stores callbacks in refs so the loop captures the latest closures without
 *   restarting the timer on every render.
 * Ported verbatim from /Users/adoll/projects/eagle-gesture-drawing/src/timer-hook.jsx
 */
export function useHighResTimer(
  durationMs: number,
  active: boolean,
  onTick: (elapsed: number) => void,
  onEnd: () => void,
  resetKey: string | number,
): void {
  const startRef = useRef<number | null>(null);
  const accumRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef(onTick);
  const endRef = useRef(onEnd);

  // Keep callback refs current without re-triggering the RAF loop effect.
  useEffect(() => {
    tickRef.current = onTick;
  }, [onTick]);
  useEffect(() => {
    endRef.current = onEnd;
  }, [onEnd]);

  // Reset accumulator + start when resetKey changes
  useEffect(() => {
    accumRef.current = 0;
    startRef.current = performance.now();
  }, [resetKey]);

  useEffect(() => {
    if (!active) {
      if (startRef.current != null) {
        accumRef.current += performance.now() - startRef.current;
      }
      startRef.current = null;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      return;
    }

    const start = () => {
      startRef.current = performance.now();
      const loop = () => {
        if (startRef.current == null) return;
        const elapsed =
          accumRef.current + (performance.now() - startRef.current);
        tickRef.current(elapsed);
        if (elapsed >= durationMs) {
          endRef.current();
          return;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    };

    const stop = () => {
      if (startRef.current != null) {
        accumRef.current += performance.now() - startRef.current;
      }
      startRef.current = null;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        stop();
      } else if (startRef.current == null) {
        start();
      }
    };

    if (typeof document !== "undefined" && document.hidden) {
      // Tab is already hidden — defer starting until visible.
    } else {
      start();
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [active, durationMs, resetKey]);
}
