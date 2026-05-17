// Browser-only. Safari < 17 doesn't have requestIdleCallback; polyfill
// with setTimeout(200). The handle-kind Map ensures cancelIdle dispatches
// to the right cancel function even if globals change between schedule
// and cancel time (test stubs, navigation, etc).
//
// Memory: the map removes entries both on natural firing (via the wrapped
// callback) and on explicit cancel — bounded to in-flight handles only.

type Kind = "ric" | "timeout";
const handleKind = new Map<number, Kind>();

/** Test-only — reset internal state between tests. Not exported from index. */
export function __resetHandleKindForTests(): void {
  handleKind.clear();
}

interface IdleOpts {
  /** Force execution after this many ms even if never idle. */
  timeout?: number;
}

export function scheduleIdle(callback: () => void, opts: IdleOpts = {}): number {
  let handle: number;
  // Wrap so we delete ourselves from the kind map on natural fire — this is
  // what prevents the map from growing unbounded across many schedule calls.
  const wrapped = () => {
    handleKind.delete(handle);
    callback();
  };

  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    handle = window.requestIdleCallback(wrapped, { timeout: opts.timeout });
    handleKind.set(handle, "ric");
    return handle;
  }
  // Polyfill: setTimeout doesn't observe true idleness, but 200ms is short
  // enough to feel responsive and long enough to deprioritize against
  // user input + render loops.
  handle = setTimeout(wrapped, 200) as unknown as number;
  handleKind.set(handle, "timeout");
  return handle;
}

export function cancelIdle(handle: number): void {
  // Default to "timeout" if we somehow lost track — clearTimeout on an
  // unknown number is harmless; cancelIdleCallback on a setTimeout id
  // would silently fail.
  const kind = handleKind.get(handle) ?? "timeout";
  handleKind.delete(handle);
  if (
    kind === "ric" &&
    typeof window !== "undefined" &&
    typeof window.cancelIdleCallback === "function"
  ) {
    window.cancelIdleCallback(handle);
  } else {
    clearTimeout(handle);
  }
}
