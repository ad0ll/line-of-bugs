import { useRef, useEffect } from "react";

/**
 * High-resolution pauseable timer.
 * - `performance.now()` + `requestAnimationFrame` loop, 60 Hz onTick.
 * - `active` boolean controls pause/resume; accumulator preserves elapsed
 *   across pause cycles.
 * - `resetKey` change → reset accumulator and restart from 0.
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
    startRef.current = performance.now();
    const loop = () => {
      const elapsed =
        accumRef.current + (performance.now() - startRef.current!);
      onTick(elapsed);
      if (elapsed >= durationMs) {
        onEnd();
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, durationMs, resetKey]);
}
