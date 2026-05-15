"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/tokens";
import type { RepeatMode } from "@/lib/repeat-mode";

interface Props {
  intervalSec: number;
  subjectType: "nature" | "specimen" | "both";
  repeatMode: RepeatMode;
}

export function StartSessionButton({ intervalSec, subjectType, repeatMode }: Props) {
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
        body: JSON.stringify({ intervalSec, subjectType, repeatMode }),
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
    <div style={{ display: "flex", flexDirection: "column", gap: T.s3, alignItems: "center" }}>
      <button
        type="button"
        onClick={start}
        disabled={pending}
        style={{
          background: T.surface2,
          color: T.textPrimary,
          border: `1px solid ${T.borderEmphasis}`,
          borderRadius: T.r3xl,
          padding: `${T.s6}px ${T.s12}px`,
          fontFamily: "var(--font-display), serif",
          fontSize: T.text2xl,
          fontWeight: 500,
          letterSpacing: 0.5,
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.6 : 1,
          transition: `transform ${T.timingBase}, background ${T.timingBase}`,
        }}
      >
        {pending ? "starting…" : "start session"}
      </button>
      {error ? (
        <p style={{ color: T.textDanger, fontSize: T.textSm, margin: 0 }}>{error}</p>
      ) : null}
    </div>
  );
}
