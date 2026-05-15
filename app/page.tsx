import { Suspense } from "react";
import { connection } from "next/server";
import { HomeClient } from "./components/home/HomeClient";
import {
  listViewCounts,
  listLifeStageCounts,
  listSexCounts,
  listTaxonGroupCounts,
} from "@/lib/queries/gallery";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readArg(v: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(v)) return v[0] ?? fallback;
  return v ?? fallback;
}

async function HomeShell({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const subjectRaw = readArg(sp.subject, "both");
  const subject: "nature" | "specimen" | "both" =
    subjectRaw === "nature" || subjectRaw === "specimen" ? subjectRaw : "both";
  const interval = Math.max(10, Math.min(3600, parseInt(readArg(sp.interval, "60"), 10) || 60));
  const repeatRaw = readArg(sp.repeat, "default");
  const repeat: "default" | "never-repeat-animals" | "allow-different-angles" =
    repeatRaw === "never-repeat-animals" || repeatRaw === "allow-different-angles"
      ? repeatRaw
      : "default";
  const [views, lifeStages, sexes, taxonGroups] = await Promise.all([
    listViewCounts(),
    listLifeStageCounts(),
    listSexCounts(),
    listTaxonGroupCounts(),
  ]);
  return (
    <HomeClient
      initialInterval={interval}
      initialSubject={subject}
      initialRepeat={repeat}
      viewCounts={views}
      lifeStageCounts={lifeStages}
      sexCounts={sexes}
      taxonGroupCounts={taxonGroups}
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
