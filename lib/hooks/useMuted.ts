"use client";
import { useEffect, useState } from "react";

const KEY = "line-of-bugs:muted";

/**
 * localStorage-backed audio-mute state for the session player.
 * Returns the current `muted` boolean and a setter that persists. SSR-safe:
 * mounts as `false` and reads from storage on client-side effect to avoid
 * hydration mismatches and works under storage-disabled environments.
 */
export function useMuted(): [boolean, (next: boolean) => void] {
  const [muted, setMuted] = useState(false);
  // Restore on mount
  useEffect(() => {
    try {
      setMuted(localStorage.getItem(KEY) === "1");
    } catch {
      /* SSR or storage disabled */
    }
  }, []);
  // Persist on change
  function update(next: boolean) {
    setMuted(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  return [muted, update];
}
