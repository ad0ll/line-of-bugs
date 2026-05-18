"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { AllOrChipsFilter, type AllOrChipsOption } from "@/app/components/filters/AllOrChipsFilter";
import { WhatIsBugFilter } from "@/app/components/filters/WhatIsBugFilter";
import { DiceRoll, type DiceRollState } from "@/app/components/filters/DiceRoll";
import type { FacetCount, FacetSnapshot } from "@/lib/queries/facets";
import type { SubjectType } from "@/lib/subject";

interface Props {
  initialSubject: SubjectType;
  initialFacets: FacetSnapshot;
  // institutions are gallery-only and loaded SSR (large enum; we don't
  // recompute counts per filter — see gallery/page.tsx)
  institutionOptions: AllOrChipsOption[];
}

function asOptions(items: FacetCount[]): AllOrChipsOption[] {
  return items.map((i) => ({ value: i.name, label: i.name, count: i.count }));
}

function parseList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

const SUBJECT_BASE = [
  { value: "wild", label: "wild" },
  { value: "specimen", label: "specimen" },
  { value: "captive", label: "captive" },
];

export function FilterChipsControls({ initialSubject, initialFacets, institutionOptions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  // No implicit default filters — every chip's initial state derives from URL
  // search params (?subject=, ?type=, ?view=, ?life=, ?sex=, ?inst=, ?q=) or
  // is empty. The only always-on predicates (hidden=0 + unresolved-report
  // exclusion in buildFilterClauses) are moderation guardrails, intentionally
  // not surfaced as chips. Verified Phase F (2026-05-17).
  const initialSubjectList = initialSubject === "all" ? [] : [initialSubject];
  const [subjects, setSubjects] = useState<string[]>(initialSubjectList);
  const [groups, setGroups] = useState<string[]>(parseList(params.get("type")));
  const [views, setViews] = useState<string[]>(parseList(params.get("view")));
  const [life, setLife] = useState<string[]>(parseList(params.get("life")));
  const [sexes, setSexes] = useState<string[]>(parseList(params.get("sex")));
  const [insts, setInsts] = useState<string[]>(parseList(params.get("inst")));
  const [species, setSpecies] = useState<string[]>(parseList(params.get("q")));

  // Live facet refresh — same pattern as home
  const [facets, setFacets] = useState<FacetSnapshot>(initialFacets);

  useEffect(() => {
    const next = new URLSearchParams();
    if (subjects.length === 1) next.set("subject", subjects[0]!);
    if (groups.length) next.set("type", groups.join(","));
    if (views.length) next.set("view", views.join(","));
    if (life.length) next.set("life", life.join(","));
    if (sexes.length) next.set("sex", sexes.join(","));
    if (insts.length) next.set("inst", insts.join(","));
    if (species.length) next.set("q", species.join(","));
    const qs = next.toString();
    const target = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => router.replace(target, { scroll: false }));
  }, [subjects, groups, views, life, sexes, insts, species, pathname, router]);

  // Refetch facets on filter change
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("subject", subjects.length === 1 ? subjects[0]! : "all");
    if (views.length) q.set("view", views.join(","));
    if (life.length) q.set("life", life.join(","));
    if (sexes.length) q.set("sex", sexes.join(","));
    if (groups.length) q.set("type", groups.join(","));
    if (insts.length) q.set("inst", insts.join(","));
    if (species.length) q.set("q", species.join(","));
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(`/api/facets?${q.toString()}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d: FacetSnapshot) => setFacets(d))
        .catch(() => { /* leave last-known facets */ });
    }, 80);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [subjects, groups, views, life, sexes, insts, species]);

  const subjectOpts: AllOrChipsOption[] = SUBJECT_BASE.map((s) => ({
    ...s,
    count: facets.subject[s.value as "wild" | "specimen" | "captive"] ?? 0,
  }));

  function onDiceRoll(state: DiceRollState) {
    // Every axis is present (cleared ones are []); apply each directly.
    setGroups(state.groups);
    setSpecies(state.species);
    setViews(state.views);
    setLife(state.lifeStages);
    setSexes(state.sexes);
    setSubjects(state.subjects);
    setInsts(state.insts);
  }

  return (
    <div className="gallery-filter-row">
      <AllOrChipsFilter
        label="photo type"
        emptyLabel="all photo types"
        options={subjectOpts}
        selected={subjects}
        onChange={setSubjects}
      />
      <WhatIsBugFilter
        selectedGroups={groups}
        selectedSpecies={species}
        onGroupsChange={setGroups}
        onSpeciesChange={setSpecies}
      />
      <AllOrChipsFilter
        label="view"
        emptyLabel="all views"
        options={asOptions(facets.views)}
        selected={views}
        onChange={setViews}
      />
      <AllOrChipsFilter
        label="life stage"
        emptyLabel="all life stages"
        options={asOptions(facets.lifeStages)}
        selected={life}
        onChange={setLife}
      />
      <AllOrChipsFilter
        label="sex"
        emptyLabel="all sexes"
        options={asOptions(facets.sexes)}
        selected={sexes}
        onChange={setSexes}
      />
      <AllOrChipsFilter
        label="institution"
        emptyLabel="all institutions"
        options={institutionOptions}
        selected={insts}
        onChange={setInsts}
      />
      <DiceRoll onRoll={onDiceRoll} />
    </div>
  );
}
