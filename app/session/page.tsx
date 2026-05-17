import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getPool } from "@/lib/session-pools";
import { SessionPlayer } from "@/app/components/session/SessionPlayer";

interface PageProps {
  searchParams: Promise<{ session?: string; interval?: string }>;
}

export default function SessionPage({ searchParams }: PageProps) {
  // Per Cache Components: dynamic data access (in-memory session pool lookup)
  // must live inside <Suspense> so the route shell can be cached/prerendered.
  return (
    <Suspense fallback={null}>
      <SessionLoader searchParams={searchParams} />
    </Suspense>
  );
}

async function SessionLoader({ searchParams }: PageProps) {
  await connection();
  const params = await searchParams;
  const sessionId = params.session;
  // Clamp to the same [10s, 1h] envelope the API enforces. Prevents URL-fed
  // sessions from getting a sub-second timer (too fast to draw) or a multi-day
  // timer (silently DoS'd against this server's session-pool TTL).
  const intervalSec = Math.max(10, Math.min(3600, Number(params.interval) || 60));

  if (!sessionId) {
    redirect("/");
  }
  const pool = getPool(sessionId);
  if (!pool || pool.items.length === 0) {
    redirect("/");
  }
  // key={sessionId} forces a fresh component instance for each new session
  // so per-slide state (bw, magnifier, paused, idx, ...) doesn't leak between
  // sessions when the route stays mounted across /session?session=A → ...=B.
  return (
    <SessionPlayer
      key={sessionId}
      items={pool.items}
      initialIntervalSec={intervalSec}
    />
  );
}
