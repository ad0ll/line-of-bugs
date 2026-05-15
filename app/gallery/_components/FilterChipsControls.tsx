'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { SubjectTypeChips, type SubjectValue, type SubjectCounts } from './SubjectTypeChips';
import { InstitutionPicker } from './InstitutionPicker';
import { FilterPopover, type FilterOption } from '@/app/components/filters/FilterPopover';

export interface FilterChipsControlsProps {
  subjectCounts: SubjectCounts;
  institutions: { name: string; count: number }[];
  viewCounts: FilterOption[];
  lifeStageCounts: FilterOption[];
  sexCounts: FilterOption[];
}

function parseList(v: string | null): string[] {
  return v ? v.split(',').filter(Boolean) : [];
}

export function FilterChipsControls({
  subjectCounts,
  institutions,
  viewCounts,
  lifeStageCounts,
  sexCounts,
}: FilterChipsControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const subject = (params.get('subject') as SubjectValue) ?? 'both';
  const selectedInst = parseList(params.get('inst'));
  const selectedViews = parseList(params.get('view'));
  const selectedLife = parseList(params.get('life'));
  const selectedSex = parseList(params.get('sex'));

  const pushNext = useCallback(
    (mut: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params);
      mut(next);
      next.delete('page');
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, router, pathname],
  );

  function makeSetList(paramName: string) {
    return (vals: string[]) =>
      pushNext((next) => {
        if (vals.length === 0) next.delete(paramName);
        else next.set(paramName, vals.join(','));
      });
  }

  function setSubject(v: SubjectValue) {
    pushNext((next) => {
      if (v === 'both') next.delete('subject');
      else next.set('subject', v);
    });
  }

  return (
    <>
      <SubjectTypeChips value={subject} counts={subjectCounts} onChange={setSubject} />
      <InstitutionPicker
        institutions={institutions}
        selected={selectedInst}
        onChange={makeSetList('inst')}
      />
      <FilterPopover
        idleLabel="view: all"
        selectedLabel={(n) => `view: ${n} selected`}
        ariaLabel="view filter"
        options={viewCounts}
        selected={selectedViews}
        onChange={makeSetList('view')}
      />
      <FilterPopover
        idleLabel="life stage: all"
        selectedLabel={(n) => `life: ${n} selected`}
        ariaLabel="life stage filter"
        options={lifeStageCounts}
        selected={selectedLife}
        onChange={makeSetList('life')}
      />
      <FilterPopover
        idleLabel="sex: all"
        selectedLabel={(n) => `sex: ${n} selected`}
        ariaLabel="sex filter"
        options={sexCounts}
        selected={selectedSex}
        onChange={makeSetList('sex')}
      />
    </>
  );
}
