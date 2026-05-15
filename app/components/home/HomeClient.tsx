"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { IntervalPicker } from "@/app/components/home/IntervalPicker";
import { SubjectFilter } from "@/app/components/home/SubjectFilter";
import { RepeatModeToggle } from "@/app/components/home/RepeatModeToggle";
import { StartSessionButton } from "@/app/components/home/StartSessionButton";
import { FilterPopover, type FilterOption } from "@/app/components/filters/FilterPopover";
import { TaxonGroupChips } from "@/app/components/filters/TaxonGroupChips";
import { CollapsibleSection } from "@/app/components/ui/CollapsibleSection";
import { Tooltip } from "@/app/components/ui/Tooltip";
import { TOOLTIPS } from "@/lib/tooltips";
import type { RepeatMode } from "@/lib/repeat-mode";
import type { SubjectType } from "@/lib/subject";

interface Props {
  initialInterval: number;
  initialSubject: SubjectType;
  initialRepeat: RepeatMode;
  viewCounts: FilterOption[];
  lifeStageCounts: FilterOption[];
  sexCounts: FilterOption[];
  taxonGroupCounts: FilterOption[];
}

function parseList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

/**
 * URL-driven home page. Every filter setting reflects in the query
 * string so a refresh preserves selection and links are shareable.
 *
 * Layout intent (R6):
 *   - interval / subject / start-session stay visible — the core flow.
 *   - "what kind of bug?" chip wall + the existing view/life/sex
 *     popovers are concealed behind two CollapsibleSections. Default
 *     closed; badge shows "(3 selected)" if a filter is active while
 *     hidden so users notice the impact.
 *   - Live pool count is always visible regardless of collapse state.
 */
export function HomeClient({
  initialInterval,
  initialSubject,
  initialRepeat,
  viewCounts,
  lifeStageCounts,
  sexCounts,
  taxonGroupCounts,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [intervalSec, setIntervalSec] = useState(initialInterval);
  const [subject, setSubject] = useState<SubjectType>(initialSubject);
  const [repeat, setRepeat] = useState<RepeatMode>(initialRepeat);
  const [views, setViews] = useState<string[]>(parseList(params.get("view")));
  const [life, setLife] = useState<string[]>(parseList(params.get("life")));
  const [sexes, setSexes] = useState<string[]>(parseList(params.get("sex")));
  const [groups, setGroups] = useState<string[]>(parseList(params.get("type")));

  // Push state → URL.
  useEffect(() => {
    const next = new URLSearchParams();
    if (intervalSec !== 60) next.set("interval", String(intervalSec));
    if (subject !== "all") next.set("subject", subject);
    if (repeat !== "default") next.set("repeat", repeat);
    if (views.length) next.set("view", views.join(","));
    if (life.length) next.set("life", life.join(","));
    if (sexes.length) next.set("sex", sexes.join(","));
    if (groups.length) next.set("type", groups.join(","));
    const qs = next.toString();
    const target = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => {
      router.replace(target, { scroll: false });
    });
  }, [intervalSec, subject, repeat, views, life, sexes, groups, pathname, router]);

  // Live count.
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
    if (groups.length) q.set("type", groups.join(","));
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
  }, [subject, views, life, sexes, groups]);

  const typeBadge = groups.length > 0 ? `${groups.length} selected` : null;
  const advancedActive = views.length + life.length + sexes.length;
  const advancedBadge = advancedActive > 0 ? `${advancedActive} selected` : null;

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
          <CollapsibleSection title="what kind of bug?" badge={typeBadge}>
            <Tooltip content={TOOLTIPS.taxonGroup.content} showIcon={false}>
              <TaxonGroupChips
                counts={taxonGroupCounts}
                selected={groups}
                onChange={setGroups}
              />
            </Tooltip>
          </CollapsibleSection>
        </section>

        <section className="home-section">
          <CollapsibleSection title="more filters" badge={advancedBadge}>
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
          </CollapsibleSection>
        </section>

        <p className="home-pool-count" aria-live="polite">
          {poolCount === null
            ? (countLoading ? "counting…" : "")
            : poolCount === 0
            ? "no images match — broaden the filters"
            : `${poolCount.toLocaleString()} bugs in your session pool`}
        </p>

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
          groups={groups}
        />

        <a href="/gallery" className="home-gallery-link">
          browse the gallery →
        </a>
      </main>
    </div>
  );
}
