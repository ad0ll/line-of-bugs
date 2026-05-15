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
}

export function StartSessionButton({
  intervalSec, subjectType, repeatMode, views, lifeStages, sexes, groups,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // ignore — permission denied or unsupported
    }
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intervalSec, subjectType, repeatMode,
          views, lifeStages, sexes, groups,
        }),
      });
      if (!res.ok) {
        setError(await res.text());
        setPending(false);
        return;
      }
      const data = (await res.json()) as { sessionId: string };
      router.push(`/session?session=${encodeURIComponent(data.sessionId)}&interval=${intervalSec}`);
    } catch (e) {
      setError(String(e));
      setPending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <button type="button" onClick={start} disabled={pending} className="home-start">
        {pending ? "starting…" : "start session"}
      </button>
      {error ? <p className="home-start-error">{error}</p> : null}
    </div>
  );
}
