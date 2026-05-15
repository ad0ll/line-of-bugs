"use client";
import { useState } from "react";
import { T } from "@/lib/tokens";
import { IntervalPicker } from "@/app/components/home/IntervalPicker";
import { SubjectFilter, type SubjectChoice } from "@/app/components/home/SubjectFilter";
import { RepeatModeToggle } from "@/app/components/home/RepeatModeToggle";
import { StartSessionButton } from "@/app/components/home/StartSessionButton";
import type { RepeatMode } from "@/lib/repeat-mode";

export default function Home() {
  const [intervalSec, setIntervalSec] = useState(60);
  const [subjectType, setSubjectType] = useState<SubjectChoice>("both");
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("default");

  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: `${T.s12 * 2}px ${T.s10}px`,
        display: "flex",
        flexDirection: "column",
        gap: T.s12,
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-display), serif",
          fontWeight: 500,
          fontSize: 42,
          letterSpacing: "-0.5px",
          margin: 0,
        }}
      >
        line of bugs
      </h1>

      <section style={{ display: "flex", flexDirection: "column", gap: T.s4 }}>
        <h2 style={{ fontSize: T.textBase, color: T.textSecondary, margin: 0, fontWeight: 500 }}>
          interval per slide
        </h2>
        <IntervalPicker value={intervalSec} onChange={setIntervalSec} />
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: T.s4 }}>
        <h2 style={{ fontSize: T.textBase, color: T.textSecondary, margin: 0, fontWeight: 500 }}>
          subject type
        </h2>
        <SubjectFilter value={subjectType} onChange={setSubjectType} />
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: T.s4 }}>
        <h2 style={{ fontSize: T.textBase, color: T.textSecondary, margin: 0, fontWeight: 500 }}>
          repeat behavior
        </h2>
        <RepeatModeToggle value={repeatMode} onChange={setRepeatMode} />
      </section>

      <StartSessionButton intervalSec={intervalSec} subjectType={subjectType} repeatMode={repeatMode} />

      <a
        href="/gallery"
        style={{
          color: T.textTertiary,
          fontSize: T.textSm,
          textAlign: "center",
          textDecoration: "none",
          marginTop: T.s8,
        }}
      >
        gallery →
      </a>
    </main>
  );
}
