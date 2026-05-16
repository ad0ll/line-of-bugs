"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { IntervalPicker } from "@/app/components/home/IntervalPicker";
import { RepeatModeToggle } from "@/app/components/home/RepeatModeToggle";
import { StartSessionButton } from "@/app/components/home/StartSessionButton";
import { FilterBar, type FilterBarState } from "@/app/components/filters/FilterBar";
import { type FilterOption } from "@/app/components/filters/FilterPopover";
import { Tooltip } from "@/app/components/ui/Tooltip";
import { TOOLTIPS } from "@/lib/tooltips";
import type { RepeatMode } from "@/lib/repeat-mode";
import { parseSubject, type SubjectType } from "@/lib/subject";
import type { FacetCount, FacetSnapshot } from "@/lib/queries/facets";

interface Props {
  initialInterval: number;
  initialSubject: SubjectType;
  initialRepeat: RepeatMode;
  initialFacets: FacetSnapshot;
}

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
 * URL-driven home page. Filter state lives in the URL — useState is
 * only used for the local "start session" form fields (interval +
 * repeat-mode) that don't need to be shareable links.
 *
 * Layout intent (R8 redesign 2026-05-16):
 *   - Title centered up top.
 *   - One vertical stack of controls: interval → FilterBar → repeat → CTAs.
 *   - No 2-column grid (the old layout left half the viewport empty).
 *   - Layperson chips visible by default — no collapse.
 *   - "browse the gallery" promoted to a sibling CTA next to "start".
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
  const [repeat, setRepeat] = useState<RepeatMode>(initialRepeat);

  // Filter state is read from + written to the URL. Initialized from
  // SSR params and from useSearchParams for client-side restoration.
  const [subject, setSubject] = useState<SubjectType>(initialSubject);
  const [views, setViews] = useState<string[]>(parseList(params.get("view")));
  const [life, setLife] = useState<string[]>(parseList(params.get("life")));
  const [sexes, setSexes] = useState<string[]>(parseList(params.get("sex")));
  const [groups, setGroups] = useState<string[]>(parseList(params.get("type")));
  const [species, setSpecies] = useState<string[]>(parseList(params.get("q")));

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
    if (species.length) next.set("q", species.join(","));
    const qs = next.toString();
    const target = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => {
      router.replace(target, { scroll: false });
    });
  }, [intervalSec, subject, repeat, views, life, sexes, groups, species, pathname, router]);

  // Faceted snapshot — refreshed on every filter change so chips
  // re-count with own-axis exclusion semantics. See git blame for the
  // dedupe + debounce rationale (batch 1 fixed a multi-second lag).
  const [facets, setFacets] = useState<FacetSnapshot>(initialFacets);
  const [facetsLoading, setFacetsLoading] = useState(false);
  const lastFetchKey = useRef<string>("");
  const initialFacetsRef = useRef(initialFacets);
  initialFacetsRef.current = initialFacets;
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("subject", subject);
    if (views.length) q.set("view", views.join(","));
    if (life.length) q.set("life", life.join(","));
    if (sexes.length) q.set("sex", sexes.join(","));
    if (groups.length) q.set("type", groups.join(","));
    const key = q.toString();
    if (key === lastFetchKey.current) return;
    lastFetchKey.current = key;

    const controller = new AbortController();
    const handle = setTimeout(() => {
      setFacetsLoading(true);
      fetch(`/api/facets?${key}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d: FacetSnapshot) => setFacets(d))
        .catch((err) => {
          if (err?.name !== "AbortError") setFacets(initialFacetsRef.current);
        })
        .finally(() => {
          if (!controller.signal.aborted) setFacetsLoading(false);
        });
    }, 80);

    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [subject, views, life, sexes, groups]);

  const poolCount = facets.total;

  const subjectCounts = {
    filtered: {
      wild: facets.subject.wild,
      captive: facets.subject.captive,
      specimen: facets.subject.specimen,
      all: facets.subject.wild + facets.subject.captive + facets.subject.specimen,
    },
    totals: {
      wild: initialFacets.subject.wild,
      captive: initialFacets.subject.captive,
      specimen: initialFacets.subject.specimen,
      all: initialFacets.subject.wild + initialFacets.subject.captive + initialFacets.subject.specimen,
    },
  };

  const filterState: FilterBarState = {
    subject, groups, species, views, lifeStages: life, sexes, institutions: [],
  };

  function handleFilterChange(next: Partial<FilterBarState>) {
    if (next.subject !== undefined) setSubject(next.subject);
    if (next.groups !== undefined) setGroups(next.groups);
    if (next.species !== undefined) setSpecies(next.species);
    if (next.views !== undefined) setViews(next.views);
    if (next.lifeStages !== undefined) setLife(next.lifeStages);
    if (next.sexes !== undefined) setSexes(next.sexes);
    // No institutions axis on home.
  }

  return (
    <div className="home-wrap">
      <main className="home-main">
        <header className="home-header">
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
              <span>filters</span>
            </Tooltip>
          </h2>
          <FilterBar
            state={filterState}
            options={{
              taxonGroups: mergeFacetCounts(facets.taxonGroups, initialFacets.taxonGroups),
              views: mergeFacetCounts(facets.views, initialFacets.views),
              lifeStages: mergeFacetCounts(facets.lifeStages, initialFacets.lifeStages),
              sexes: mergeFacetCounts(facets.sexes, initialFacets.sexes),
              subjectCounts,
            }}
            onChange={handleFilterChange}
          />
        </section>

        <p className="home-pool-count" aria-live="polite">
          {facetsLoading
            ? "counting…"
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

        <div className="home-ctas">
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
        </div>
      </main>
    </div>
  );
}
