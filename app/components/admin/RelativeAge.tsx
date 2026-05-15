"use client";
import { useEffect, useState } from "react";

function format(elapsed: number): string {
  if (elapsed < 60) return `${Math.floor(elapsed)}s ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  return `${Math.floor(elapsed / 86400)}d ago`;
}

// Client-only relative age so SSR/CSR can't disagree on "now"; renders empty
// pre-mount, fills in on hydration. Avoids suppressHydrationWarning hacks.
export function RelativeAge({ unixSeconds }: { unixSeconds: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now() / 1000);
    const t = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span />;
  return <span>{format(now - unixSeconds)}</span>;
}
