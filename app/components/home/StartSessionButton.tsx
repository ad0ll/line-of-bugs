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
  /** Externally-driven disabled state (e.g. empty session pool). */
  disabled?: boolean;
}

export function StartSessionButton({
  intervalSec, subjectType, repeatMode, views, lifeStages, sexes, groups, species, disabled = false,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    // Phase F (2026-05-17) safety: if the POST succeeds but router.push
    // silently fails (back-navigation mid-flight, network race during page
    // nav), pending=true would stick forever and the button would read
    // "starting…" indefinitely. 12s is well over the worst-case happy
    // path; longer than this we assume something has gone wrong and
    // reset so the user can retry.
    const safety = window.setTimeout(() => {
      setPending(false);
      setError("took too long — please try again");
    }, 12_000);
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
        window.clearTimeout(safety);
        setError(await res.text());
        setPending(false);
        return;
      }
      const data = (await res.json()) as { sessionId: string };
      window.clearTimeout(safety);
      router.push(`/session?session=${encodeURIComponent(data.sessionId)}&interval=${intervalSec}`);
      // Intentionally do NOT clear pending here — the component unmounts on
      // successful navigation. If the user back-navigates before /session
      // renders, React Suspense will re-render this component with pending=true
      // which is harmless (button is just disabled; user can click again).
    } catch (e) {
      window.clearTimeout(safety);
      setError(String(e));
      setPending(false);
    }
  }

  return (
    <div className="home-start-stack">
      <button type="button" onClick={start} disabled={pending || disabled} className="home-start">
        {pending ? "starting…" : "start session"}
      </button>
      {error ? <p className="home-start-error">{error}</p> : null}
    </div>
  );
}
