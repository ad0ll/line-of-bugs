"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { IntervalPicker } from "@/app/components/home/IntervalPicker";
import { SubjectFilter, type SubjectChoice } from "@/app/components/home/SubjectFilter";
import { RepeatModeToggle } from "@/app/components/home/RepeatModeToggle";
import { StartSessionButton } from "@/app/components/home/StartSessionButton";
import { FilterPopover, type FilterOption } from "@/app/components/filters/FilterPopover";
import { Tooltip } from "@/app/components/ui/Tooltip";
import { TOOLTIPS } from "@/lib/tooltips";
import type { RepeatMode } from "@/lib/repeat-mode";

interface Props {
  initialInterval: number;
  initialSubject: SubjectChoice;
  initialRepeat: RepeatMode;
  viewCounts: FilterOption[];
  lifeStageCounts: FilterOption[];
  sexCounts: FilterOption[];
}

function parseList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

/**
 * URL-driven home page: every filter setting is reflected in the query
 * string so a refresh preserves the user's selection and so links can
 * be shared. The live count is fetched from /api/session/count
 * whenever the filters change.
 */
export function HomeClient({
  initialInterval,
  initialSubject,
  initialRepeat,
  viewCounts,
  lifeStageCounts,
  sexCounts,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [intervalSec, setIntervalSec] = useState(initialInterval);
  const [subject, setSubject] = useState<SubjectChoice>(initialSubject);
  const [repeat, setRepeat] = useState<RepeatMode>(initialRepeat);
  const [views, setViews] = useState<string[]>(parseList(params.get("view")));
  const [life, setLife] = useState<string[]>(parseList(params.get("life")));
  const [sexes, setSexes] = useState<string[]>(parseList(params.get("sex")));

  // Push the current state into the URL whenever it changes — but only
  // wrap in a transition so the live-count fetch doesn't pause the UI.
  useEffect(() => {
    const next = new URLSearchParams();
    if (intervalSec !== 60) next.set("interval", String(intervalSec));
    if (subject !== "both") next.set("subject", subject);
    if (repeat !== "default") next.set("repeat", repeat);
    if (views.length) next.set("view", views.join(","));
    if (life.length) next.set("life", life.join(","));
    if (sexes.length) next.set("sex", sexes.join(","));
    const qs = next.toString();
    const target = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => {
      router.replace(target, { scroll: false });
    });
  }, [intervalSec, subject, repeat, views, life, sexes, pathname, router]);

  // Live count — AbortController so rapid filter changes cancel the in-flight
  // request on the network rather than just discarding the result.
  const [poolCount, setPoolCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setCountLoading(true);
    const q = new URLSearchParams();
    q.set("subject", subject);
    if (views.length) q.set("view", views.join(","));
    if (life.length) q.set("life", life.join(","));
    if (sexes.length) q.set("sex", sexes.join(","));
    fetch(`/api/session/count?${q.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d: { count: number }) => setPoolCount(d.count))
      .catch((err) => {
        if (err?.name !== "AbortError") setPoolCount(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCountLoading(false);
      });
    return () => controller.abort();
  }, [subject, views, life, sexes]);

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
          <h2 className="home-section-title">
            <Tooltip content={TOOLTIPS.interval.content}>
              <span>interval per slide</span>
            </Tooltip>
          </h2>
          <IntervalPicker value={intervalSec} onChange={setIntervalSec} />
        </section>

        <section className="home-section">
          <h2 className="home-section-title">
            <Tooltip content={TOOLTIPS.subject.content}>
              <span>subject type</span>
            </Tooltip>
          </h2>
          <SubjectFilter value={subject} onChange={setSubject} />
        </section>

        <section className="home-section">
          <h2 className="home-section-title">narrow the pool</h2>
          <div className="home-filter-row">
            <Tooltip content={TOOLTIPS.view.content} showIcon={false}>
              <FilterPopover
                idleLabel="view: all"
                selectedLabel={(n) => `view: ${n} selected`}
                ariaLabel="view filter"
                options={viewCounts}
                selected={views}
                onChange={setViews}
              />
            </Tooltip>
            <Tooltip content={TOOLTIPS.lifeStage.content} showIcon={false}>
              <FilterPopover
                idleLabel="life stage: all"
                selectedLabel={(n) => `life: ${n} selected`}
                ariaLabel="life stage filter"
                options={lifeStageCounts}
                selected={life}
                onChange={setLife}
              />
            </Tooltip>
            <Tooltip content={TOOLTIPS.sex.content} showIcon={false}>
              <FilterPopover
                idleLabel="sex: all"
                selectedLabel={(n) => `sex: ${n} selected`}
                ariaLabel="sex filter"
                options={sexCounts}
                selected={sexes}
                onChange={setSexes}
              />
            </Tooltip>
          </div>
          <p className="home-pool-count" aria-live="polite">
            {poolCount === null
              ? (countLoading ? "counting…" : "")
              : poolCount === 0
              ? "no images match — broaden the filters"
              : `${poolCount.toLocaleString()} bugs in your session pool`}
          </p>
        </section>

        <section className="home-section">
          <h2 className="home-section-title">
            <Tooltip content={TOOLTIPS.repeatMode.content}>
              <span>repeat behavior</span>
            </Tooltip>
          </h2>
          <RepeatModeToggle value={repeat} onChange={setRepeat} />
        </section>

        <StartSessionButton
          intervalSec={intervalSec}
          subjectType={subject}
          repeatMode={repeat}
          views={views}
          lifeStages={life}
          sexes={sexes}
        />

        <a href="/gallery" className="home-gallery-link">
          browse the gallery →
        </a>
      </main>
    </div>
  );
}
