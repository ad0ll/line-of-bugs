'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { SubjectTypeChips, type SubjectCounts } from './SubjectTypeChips';
import { parseSubject, type SubjectType } from '@/lib/subject';

export interface SubjectCountPair {
  /** Filtered counts — other-axis applied, subject ignored. */
  filtered: { wild: number; captive: number; specimen: number };
  /** Unfiltered totals. */
  totals: { wild: number; captive: number; specimen: number };
}
import { InstitutionPicker } from './InstitutionPicker';
import { FilterPopover, type FilterOption } from '@/app/components/filters/FilterPopover';
import { TaxonGroupChips } from '@/app/components/filters/TaxonGroupChips';
import { CollapsibleSection } from '@/app/components/ui/CollapsibleSection';
import { Tooltip } from '@/app/components/ui/Tooltip';
import { TOOLTIPS } from '@/lib/tooltips';

export interface FilterChipsControlsProps {
  subject: SubjectCountPair;
  institutions: { name: string; count: number }[];
  viewCounts: FilterOption[];
  lifeStageCounts: FilterOption[];
  sexCounts: FilterOption[];
  taxonGroupCounts: FilterOption[];
}

function toSubjectCounts(
  pair: { wild: number; captive: number; specimen: number },
): SubjectCounts {
  return {
    wild: pair.wild,
    captive: pair.captive,
    specimen: pair.specimen,
    all: pair.wild + pair.captive + pair.specimen,
  };
}

function parseList(v: string | null): string[] {
  return v ? v.split(',').filter(Boolean) : [];
}

export function FilterChipsControls({
  subject: subjectPair,
  institutions,
  viewCounts,
  lifeStageCounts,
  sexCounts,
  taxonGroupCounts,
}: FilterChipsControlsProps) {
  const filteredSubject = toSubjectCounts(subjectPair.filtered);
  const totalsSubject = toSubjectCounts(subjectPair.totals);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const subject = parseSubject(params.get('subject'));
  const selectedInst = parseList(params.get('inst'));
  const selectedViews = parseList(params.get('view'));
  const selectedLife = parseList(params.get('life'));
  const selectedSex = parseList(params.get('sex'));
  const selectedTypes = parseList(params.get('type'));

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

  function setSubject(v: SubjectType) {
    pushNext((next) => {
      if (v === 'all') next.delete('subject');
      else next.set('subject', v);
    });
  }

  // Helper: count of active filters per collapse section, for the
  // "(3 selected)" badge that surfaces from the closed state.
  const typeBadge = selectedTypes.length > 0 ? `${selectedTypes.length} selected` : null;
  const advancedActive =
    selectedViews.length + selectedLife.length + selectedSex.length + selectedInst.length;
  const advancedBadge = advancedActive > 0 ? `${advancedActive} selected` : null;

  return (
    <>
      {/* Subject chips stay always-visible (most-used, recognized term). */}
      <SubjectTypeChips
        value={subject}
        filtered={filteredSubject}
        totals={totalsSubject}
        onChange={setSubject}
      />

      {/* Open the sections when filters are pre-selected via URL so
          users see the active filters without having to expand. */}
      <CollapsibleSection
        title="what kind of bug?"
        badge={typeBadge}
        defaultOpen={selectedTypes.length > 0}
      >
        <Tooltip content={TOOLTIPS.taxonGroup.content} showIcon={false}>
          <TaxonGroupChips
            counts={taxonGroupCounts}
            selected={selectedTypes}
            onChange={makeSetList('type')}
          />
        </Tooltip>
      </CollapsibleSection>

      <CollapsibleSection
        title="more filters"
        badge={advancedBadge}
        defaultOpen={advancedActive > 0}
      >
        <div className="advanced-filter-row">
          <Tooltip content={TOOLTIPS.institution.content} showIcon={false}>
            <InstitutionPicker
              institutions={institutions}
              selected={selectedInst}
              onChange={makeSetList('inst')}
            />
          </Tooltip>
          <Tooltip content={TOOLTIPS.view.content} showIcon={false}>
            <FilterPopover
              idleLabel="view: all"
              selectedLabel={(n) => `view: ${n} selected`}
              ariaLabel="view filter"
              options={viewCounts}
              selected={selectedViews}
              onChange={makeSetList('view')}
            />
          </Tooltip>
          <Tooltip content={TOOLTIPS.lifeStage.content} showIcon={false}>
            <FilterPopover
              idleLabel="life stage: all"
              selectedLabel={(n) => `life: ${n} selected`}
              ariaLabel="life stage filter"
              options={lifeStageCounts}
              selected={selectedLife}
              onChange={makeSetList('life')}
            />
          </Tooltip>
          <Tooltip content={TOOLTIPS.sex.content} showIcon={false}>
            <FilterPopover
              idleLabel="sex: all"
              selectedLabel={(n) => `sex: ${n} selected`}
              ariaLabel="sex filter"
              options={sexCounts}
              selected={selectedSex}
              onChange={makeSetList('sex')}
            />
          </Tooltip>
        </div>
      </CollapsibleSection>
    </>
  );
}
