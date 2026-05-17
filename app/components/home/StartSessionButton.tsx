"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RepeatMode } from "@/lib/repeat-mode";
import type { SubjectType } from "@/lib/subject";

interface Props {
  intervalSec: number;
  subjectType: SubjectType;
  repeatMode: RepeatMode;
  views: string[];
  lifeStages: string[];
  sexes: string[];
  groups: string[];
  /** Species tags (booru-style multi-tag search). When the home
   *  filter is in "species" mode, selected tags flow through here
   *  so the session pool respects them. */
  species: string[];
}

export function StartSessionButton({
  intervalSec, subjectType, repeatMode, views, lifeStages, sexes, groups, species,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intervalSec, subjectType, repeatMode,
          views, lifeStages, sexes, groups,
          q: species,
        }),
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      const data = (await res.json()) as { sessionId: string };
      router.push(`/session?session=${encodeURIComponent(data.sessionId)}&interval=${intervalSec}`);
    } catch (e) {
      setError(String(e));
    } finally {
      // Always clear pending — covers cancelled navigation (router.push
      // throws on user back-nav under React Suspense), network errors,
      // and the happy path equally.
      setPending(false);
    }
  }

  return (
    <div className="home-start-stack">
      <button type="button" onClick={start} disabled={pending} className="home-start">
        {pending ? "starting…" : "start session"}
      </button>
      {error ? <p className="home-start-error">{error}</p> : null}
    </div>
  );
}
