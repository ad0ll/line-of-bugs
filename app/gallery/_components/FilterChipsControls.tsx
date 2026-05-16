'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { FilterBar, type FilterBarState } from '@/app/components/filters/FilterBar';
import type { FilterOption } from '@/app/components/filters/FilterPopover';
import { parseSubject, type SubjectType } from '@/lib/subject';

export interface SubjectCountPair {
  filtered: { wild: number; captive: number; specimen: number };
  totals:   { wild: number; captive: number; specimen: number };
}

export interface FilterChipsControlsProps {
  subject: SubjectCountPair;
  institutions: { name: string; count: number }[];
  viewCounts: FilterOption[];
  lifeStageCounts: FilterOption[];
  sexCounts: FilterOption[];
  taxonGroupCounts: FilterOption[];
}

function parseList(v: string | null): string[] {
  return v ? v.split(',').filter(Boolean) : [];
}

function withAll(s: { wild: number; captive: number; specimen: number }) {
  return { ...s, all: s.wild + s.captive + s.specimen };
}

export function FilterChipsControls({
  subject: subjectPair,
  institutions,
  viewCounts,
  lifeStageCounts,
  sexCounts,
  taxonGroupCounts,
}: FilterChipsControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const state: FilterBarState = {
    subject: parseSubject(params.get('subject')),
    groups: parseList(params.get('type')),
    species: parseList(params.get('q')),
    views: parseList(params.get('view')),
    lifeStages: parseList(params.get('life')),
    sexes: parseList(params.get('sex')),
    institutions: parseList(params.get('inst')),
  };

  const pushNext = useCallback(
    (mut: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params);
      mut(next);
      next.delete('page');
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, router, pathname],
  );

  function handleChange(next: Partial<FilterBarState>) {
    pushNext((url) => {
      if (next.subject !== undefined) {
        if (next.subject === 'all') url.delete('subject');
        else url.set('subject', next.subject);
      }
      if (next.groups !== undefined) {
        if (next.groups.length === 0) url.delete('type');
        else url.set('type', next.groups.join(','));
      }
      if (next.species !== undefined) {
        if (next.species.length === 0) url.delete('q');
        else url.set('q', next.species.join(','));
      }
      if (next.views !== undefined) {
        if (next.views.length === 0) url.delete('view');
        else url.set('view', next.views.join(','));
      }
      if (next.lifeStages !== undefined) {
        if (next.lifeStages.length === 0) url.delete('life');
        else url.set('life', next.lifeStages.join(','));
      }
      if (next.sexes !== undefined) {
        if (next.sexes.length === 0) url.delete('sex');
        else url.set('sex', next.sexes.join(','));
      }
      if (next.institutions !== undefined) {
        if (next.institutions.length === 0) url.delete('inst');
        else url.set('inst', next.institutions.join(','));
      }
    });
  }

  return (
    <FilterBar
      state={state}
      options={{
        taxonGroups: taxonGroupCounts,
        views: viewCounts,
        lifeStages: lifeStageCounts,
        sexes: sexCounts,
        institutions,
        subjectCounts: {
          filtered: withAll(subjectPair.filtered),
          totals: withAll(subjectPair.totals),
        },
      }}
      onChange={handleChange}
    />
  );
}
