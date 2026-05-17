import type { SketchfabSearchResponse } from "./types";
import { anySignal } from "./abort-helpers";

const TIMEOUT_MS = 5000;

/**
 * Distinct from a generic network error so the panel can render a
 * timeout-specific message ("couldn't find anything in time") rather
 * than the generic "couldn't reach Sketchfab" copy.
 */
export class SketchfabTimeoutError extends Error {
  constructor() {
    super(`sketchfab request timed out after ${TIMEOUT_MS}ms`);
    this.name = "SketchfabTimeoutError";
  }
}

/**
 * Wraps the /api/sketchfab/search call with a 5s cap. Above that, the
 * panel UI surfaces the timeout-specific empty-state — better UX than
 * the ~30s wait that happens when prod's egress IP is bot-blocked by
 * Akamai and Sketchfab never responds.
 *
 * Uses setTimeout (not AbortSignal.timeout) so vi.useFakeTimers can
 * intercept it in tests. AbortSignal.timeout is a host timer that fake
 * timers do not patch.
 *
 * Respects the caller's AbortSignal (React Query passes one via
 * useQuery's queryFn) so unmounts cancel cleanly.
 */
export async function fetchSketchfabWithTimeout(
  scientific: string,
  common: string,
  callerSignal: AbortSignal,
): Promise<SketchfabSearchResponse> {
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(
    () => timeoutCtrl.abort(new SketchfabTimeoutError()),
    TIMEOUT_MS,
  );
  const signal = anySignal([callerSignal, timeoutCtrl.signal]);

  try {
    const u = new URL("/api/sketchfab/search", window.location.origin);
    u.searchParams.set("scientific", scientific);
    u.searchParams.set("common", common);
    const r = await fetch(u.toString(), { signal });
    if (!r.ok) throw new Error(`sketchfab search failed: ${r.status}`);
    return (await r.json()) as SketchfabSearchResponse;
  } catch (e) {
    if (timeoutCtrl.signal.aborted) throw new SketchfabTimeoutError();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
