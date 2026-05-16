"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface Props {
  /** Polling interval in milliseconds. */
  intervalMs?: number;
}

/**
 * Mounted in the admin reports Server Component so the queue picks up new
 * student reports without a manual reload. router.refresh() re-runs the
 * route's data fetches without remounting the client subtree, so visual
 * state (focus, scroll position, in-flight ConfirmDeleteButton arming)
 * survives the refresh.
 *
 * 30s is a balance between freshness and chattiness — the queue is rarely
 * hot enough to need sub-30s, but tab focus is a useful add later.
 */
export function AutoRefresh({ intervalMs = 30_000 }: Props) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
