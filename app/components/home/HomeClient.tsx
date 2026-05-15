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
import type { FacetCount, FacetSnapshot } from "@/lib/queries/facets";

interface Props {
  initialInterval: number;
  initialSubject: SubjectType;
  initialRepeat: RepeatMode;
  initialFacets: FacetSnapshot;
}

/**
 * Merge the absolute "totals" snapshot with the live "filtered" one
 * into the {name, count, total} shape FilterPopover/TaxonGroupChips
 * expect. Order is preserved from the totals array (whichever order
 * server-side returned them in).
 */
function mergeFacetCounts(
  filtered: FacetCount[],
  totals: FacetCount[],
): FilterOption[] {
  const byName = new Map(filtered.map((f) => [f.name, f.count]));
  return totals.map((t) => ({
    name: t.name,
    count: byName.get(t.name) ?? 0,
    total: t.count,
  }));
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
  initialFacets,
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

  // Faceted snapshot — refreshed on every filter change so chips
  // re-count with own-axis exclusion semantics.
  const [facets, setFacets] = useState<FacetSnapshot>(initialFacets);
  const [facetsLoading, setFacetsLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setFacetsLoading(true);
    const q = new URLSearchParams();
    q.set("subject", subject);
    if (views.length) q.set("view", views.join(","));
    if (life.length) q.set("life", life.join(","));
    if (sexes.length) q.set("sex", sexes.join(","));
    if (groups.length) q.set("type", groups.join(","));
    fetch(`/api/facets?${q.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d: FacetSnapshot) => setFacets(d))
      .catch((err) => {
        if (err?.name !== "AbortError") setFacets(initialFacets);
      })
      .finally(() => {
        if (!controller.signal.aborted) setFacetsLoading(false);
      });
    return () => controller.abort();
  }, [subject, views, life, sexes, groups, initialFacets]);

  const poolCount = facets.total;
  const countLoading = facetsLoading;

  const typeBadge = groups.length > 0 ? `${groups.length} selected` : null;
  const advancedActive = views.length + life.length + sexes.length;
  const advancedBadge = advancedActive > 0 ? `${advancedActive} selected` : null;

  // Merge filtered counts (axis-excluded) with unchanging totals so
  // chips render "filtered / total" when they differ.
  const taxonGroupOptions = mergeFacetCounts(facets.taxonGroups, initialFacets.taxonGroups);
  const viewOptions = mergeFacetCounts(facets.views, initialFacets.views);
  const lifeOptions = mergeFacetCounts(facets.lifeStages, initialFacets.lifeStages);
  const sexOptions = mergeFacetCounts(facets.sexes, initialFacets.sexes);

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
                counts={taxonGroupOptions}
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
                  options={viewOptions}
                  selected={views}
                  onChange={setViews}
                />
              </Tooltip>
              <Tooltip content={TOOLTIPS.lifeStage.content} showIcon={false}>
                <FilterPopover
                  idleLabel="life stage: all"
                  selectedLabel={(n) => `life: ${n} selected`}
                  ariaLabel="life stage filter"
                  options={lifeOptions}
                  selected={life}
                  onChange={setLife}
                />
              </Tooltip>
              <Tooltip content={TOOLTIPS.sex.content} showIcon={false}>
                <FilterPopover
                  idleLabel="sex: all"
                  selectedLabel={(n) => `sex: ${n} selected`}
                  ariaLabel="sex filter"
                  options={sexOptions}
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
