"use client";
import { useState } from "react";
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
    <div className="home-wrap">
      <div aria-hidden className="home-bloom" />
      <main className="home-main">
        <header>
          <h1 className="home-title">line of bugs</h1>
          <p className="home-tagline">
            gesture drawing practice with five thousand insects, tenderly photographed
          </p>
        </header>

        <section className="home-section">
          <h2 className="home-section-title">interval per slide</h2>
          <IntervalPicker value={intervalSec} onChange={setIntervalSec} />
        </section>

        <section className="home-section">
          <h2 className="home-section-title">subject type</h2>
          <SubjectFilter value={subjectType} onChange={setSubjectType} />
        </section>

        <section className="home-section">
          <h2 className="home-section-title">repeat behavior</h2>
          <RepeatModeToggle value={repeatMode} onChange={setRepeatMode} />
        </section>

        <StartSessionButton intervalSec={intervalSec} subjectType={subjectType} repeatMode={repeatMode} />

        <a href="/gallery" className="home-gallery-link">
          ✿ browse the gallery →
        </a>
      </main>
    </div>
  );
}
