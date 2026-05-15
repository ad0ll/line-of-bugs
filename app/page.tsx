import { Suspense } from "react";
import { connection } from "next/server";
import { HomeClient } from "./components/home/HomeClient";
import { getUnfilteredFacets } from "@/lib/queries/facets";
import { parseSubject } from "@/lib/subject";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readArg(v: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(v)) return v[0] ?? fallback;
  return v ?? fallback;
}

async function HomeShell({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const subject = parseSubject(readArg(sp.subject, "all"));
  const interval = Math.max(10, Math.min(3600, parseInt(readArg(sp.interval, "60"), 10) || 60));
  const repeatRaw = readArg(sp.repeat, "default");
  const repeat: "default" | "never-repeat-animals" | "allow-different-angles" =
    repeatRaw === "never-repeat-animals" || repeatRaw === "allow-different-angles"
      ? repeatRaw
      : "default";
  // Initial render uses the *unfiltered* facets — they double as both
  // "filtered" and "total" at render time (count === total → single
  // number). The client refreshes filtered counts via /api/facets on
  // every filter change; totals stay frozen for the lifetime of the
  // page load.
  const initialFacets = await getUnfilteredFacets();
  return (
    <HomeClient
      initialInterval={interval}
      initialSubject={subject}
      initialRepeat={repeat}
      initialFacets={initialFacets}
    />
  );
}

export default function HomePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="home-wrap" />}>
      <HomeShell searchParams={searchParams} />
    </Suspense>
  );
}
