/**
 * Combine multiple AbortSignals into one that aborts as soon as any of the
 * inputs aborts. Uses native `AbortSignal.any` when available (Chrome 116+,
 * Firefox 124+, Safari 17.4+); polyfills with event-listener forwarding on
 * older Safari (a non-trivial chunk of iPad / older iPhone students).
 *
 * Without this polyfill, `AbortSignal.any([...])` throws TypeError on
 * unsupported browsers and the panel fetch breaks entirely.
 *
 * Polyfill listener lifetime: `{ signal: ctrl.signal }` auto-removes the
 * listener IF `ctrl` ever aborts. On the happy path (fast successful fetch,
 * no abort), the listener stays on each input signal until that input
 * signal itself is GC'd. In our use case the input signals are React
 * Query's per-query AbortSignal (lifetime ≤ 5s due to our timeout) and a
 * timeoutCtrl created locally per call — both short-lived. The 2 listener
 * closures × ~100 bytes each × 5s lifetime is negligible. Don't worry
 * about it.
 */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), {
      once: true,
      signal: ctrl.signal,
    });
  }
  return ctrl.signal;
}
