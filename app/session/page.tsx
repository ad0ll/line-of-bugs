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
  const intervalSec = Number(params.interval) || 60;

  if (!sessionId) {
    redirect("/");
  }
  const pool = getPool(sessionId);
  if (!pool || pool.items.length === 0) {
    redirect("/");
  }
  return <SessionPlayer items={pool.items} initialIntervalSec={intervalSec} />;
}
