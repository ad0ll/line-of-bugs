"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { IntervalPicker } from "@/app/components/home/IntervalPicker";
import { RepeatModeToggle } from "@/app/components/home/RepeatModeToggle";
import { StartSessionButton } from "@/app/components/home/StartSessionButton";
import { HeroBlock } from "@/app/components/home/HeroBlock";
import { SocialRow } from "@/app/components/home/SocialRow";
import { AllOrChipsFilter, type AllOrChipsOption } from "@/app/components/filters/AllOrChipsFilter";
import { WhatIsBugFilter } from "@/app/components/filters/WhatIsBugFilter";
import { Tooltip } from "@/app/components/ui/Tooltip";
import { GalleryIcon, WiltedFlower } from "@/app/components/icons";
import { TOOLTIPS } from "@/lib/tooltips";
import type { RepeatMode } from "@/lib/repeat-mode";
import { type SubjectType } from "@/lib/subject";
import type { FacetCount, FacetSnapshot } from "@/lib/queries/facets";

interface Props {
  initialInterval: number;
  initialSubject: SubjectType;
  initialRepeat: RepeatMode;
  initialFacets: FacetSnapshot;
}

function asOptions(items: FacetCount[]): AllOrChipsOption[] {
  return items.map((i) => ({ value: i.name, label: i.name, count: i.count }));
}

function parseList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

const SUBJECT_OPTS_BASE = [
  { value: "wild", label: "wild" },
  { value: "specimen", label: "specimen" },
  { value: "captive", label: "captive" },
];

export const POOL_COPY_PRIMARY = "you have {n} bugs to draw";
export const POOL_COPY_RARE = "{n} bugs are waiting";
// Roll once per browser session. 1 / 1,000,000 chance of the rare variant —
// users who see it can screenshot. Don't re-roll on count change.
export function pickPoolCopy(): string {
  if (typeof window !== "undefined" && Math.random() < 1e-6) {
    return POOL_COPY_RARE;
  }
  return POOL_COPY_PRIMARY;
}

export function HomeClient({ initialInterval, initialSubject, initialRepeat, initialFacets }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [intervalSec, setIntervalSec] = useState(initialInterval);
  const [novelty, setNovelty] = useState<RepeatMode>(initialRepeat);
  // Multi-select subject (was single-select). "all" is the empty state.
  const initialSubjectList = initialSubject === "all" ? [] : [initialSubject];
  const [subjects, setSubjects] = useState<string[]>(initialSubjectList);
  const [views, setViews] = useState<string[]>(parseList(params.get("view")));
  const [life, setLife] = useState<string[]>(parseList(params.get("life")));
  const [sexes, setSexes] = useState<string[]>(parseList(params.get("sex")));
  const [groups, setGroups] = useState<string[]>(parseList(params.get("type")));
  const [species, setSpecies] = useState<string[]>(parseList(params.get("q")));

  // Push state → URL.
  useEffect(() => {
    const next = new URLSearchParams();
    if (intervalSec !== 60) next.set("interval", String(intervalSec));
    if (novelty !== "default") next.set("repeat", novelty);
    if (subjects.length === 1) next.set("subject", subjects[0]!);
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
  }, [intervalSec, novelty, subjects, views, life, sexes, groups, species, pathname, router]);

  // Console message for the curious — only runs once per mount in production.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(
      "%c🐞 line of bugs %c· thanks for poking around. prs welcome → github.com/ad0ll/line-of-bugs",
      "color:#FF6EC7;font-weight:bold;font-size:14px",
      "color:#A78BFA",
    );
  }, []);

  // Faceted snapshot, novelty-aware.
  const [facets, setFacets] = useState<FacetSnapshot>(initialFacets);
  const [facetsLoading, setFacetsLoading] = useState(false);
  const lastFetchKey = useRef<string>("");
  const initialFacetsRef = useRef(initialFacets);
  initialFacetsRef.current = initialFacets;
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("subject", subjects.length === 1 ? subjects[0]! : "all");
    if (views.length) q.set("view", views.join(","));
    if (life.length) q.set("life", life.join(","));
    if (sexes.length) q.set("sex", sexes.join(","));
    if (groups.length) q.set("type", groups.join(","));
    if (species.length) q.set("q", species.join(","));
    q.set("novelty", noveltyToParam(novelty));
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
    return () => { clearTimeout(handle); controller.abort(); };
  }, [subjects, views, life, sexes, groups, species, novelty]);

  const poolCount = facets.total;

  // Subject options carry per-bucket counts from the facets snapshot.
  const subjectOpts: AllOrChipsOption[] = SUBJECT_OPTS_BASE.map((s) => ({
    ...s,
    count: facets.subject[s.value as "wild" | "specimen" | "captive"] ?? 0,
  }));

  // Subject is single-effective-but-stored-as-array for URL compat.
  // Photo type rename: empty/all = no subject filter.
  const subjectTypeForStart = subjects.length === 1 ? (subjects[0] as SubjectType) : "all";

  const poolCopyTemplate = useRef(pickPoolCopy());

  return (
    <div className="home-wrap">
      <main className="home-main">
        <HeroBlock totalCount={initialFacetsRef.current.total} />

        <div className="home-setup-area">
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
              <span>filters</span>
              {/* No tooltip — nothing meaningful to explain. */}
            </h2>
            <div className="home-filter-rows">
              <FilterRow label="photo type">
                <AllOrChipsFilter
                  label="photo type"
                  emptyLabel="all photo types"
                  options={subjectOpts}
                  selected={subjects}
                  onChange={setSubjects}
                />
              </FilterRow>
              <FilterRow label="what bug">
                <WhatIsBugFilter
                  selectedGroups={groups}
                  selectedSpecies={species}
                  onGroupsChange={setGroups}
                  onSpeciesChange={setSpecies}
                />
              </FilterRow>
              <FilterRow label="view">
                <AllOrChipsFilter
                  label="view"
                  emptyLabel="all views"
                  options={asOptions(facets.views)}
                  selected={views}
                  onChange={setViews}
                />
              </FilterRow>
              <FilterRow label="life stage">
                <AllOrChipsFilter
                  label="life stage"
                  emptyLabel="all life stages"
                  options={asOptions(facets.lifeStages)}
                  selected={life}
                  onChange={setLife}
                />
              </FilterRow>
              <FilterRow label="sex">
                <AllOrChipsFilter
                  label="sex"
                  emptyLabel="all sexes"
                  options={asOptions(facets.sexes)}
                  selected={sexes}
                  onChange={setSexes}
                />
              </FilterRow>
            </div>
          </section>

          <section className="home-section">
            <h2 className="home-section-title">
              <Tooltip content={TOOLTIPS.repeatMode.content}>
                <span>novelty</span>
              </Tooltip>
            </h2>
            <RepeatModeToggle value={novelty} onChange={setNovelty} />
          </section>
        </div>

        <p className="home-pool-count" aria-live="polite">
          {facetsLoading ? (
            "counting…"
          ) : poolCount === 0 ? (
            <span className="home-pool-empty">
              <WiltedFlower size={22} /> no insects match — try broadening the filters
            </span>
          ) : (() => {
            const [before, after] = poolCopyTemplate.current.split("{n}");
            return (
              <>
                {before}
                <span key={poolCount} className="home-pool-count-num">{poolCount.toLocaleString()}</span>
                {after}
              </>
            );
          })()}
        </p>

        <div className="home-ctas">
          <StartSessionButton
            intervalSec={intervalSec}
            subjectType={subjectTypeForStart}
            repeatMode={novelty}
            views={views}
            lifeStages={life}
            sexes={sexes}
            species={species}
            groups={groups}
            disabled={poolCount === 0}
          />
          <a href="/gallery" className="home-gallery-link">
            <GalleryIcon size={22} className="home-gallery-link-icon" />
            browse the gallery <span aria-hidden>→</span>
          </a>
        </div>

        <SocialRow />
      </main>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="home-filter-row">
      <span className="home-filter-row-label">{label}</span>
      <div className="home-filter-row-control">{children}</div>
    </div>
  );
}

function noveltyToParam(m: RepeatMode): string {
  // URL/RepeatMode values were "default | never-repeat-animals | allow-different-angles".
  // API expects show-everything | never-repeat-species | allow-different-angles.
  if (m === "default") return "show-everything";
  if (m === "never-repeat-animals") return "never-repeat-species";
  return "allow-different-angles";
}
