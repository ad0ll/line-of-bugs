'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { SubjectTypeChips, type SubjectValue, type SubjectCounts } from './SubjectTypeChips';
import { InstitutionPicker } from './InstitutionPicker';
import { FilterPopover, type FilterOption } from '@/app/components/filters/FilterPopover';
import { TaxonGroupChips } from '@/app/components/filters/TaxonGroupChips';
import { CollapsibleSection } from '@/app/components/ui/CollapsibleSection';
import { Tooltip } from '@/app/components/ui/Tooltip';
import { TOOLTIPS } from '@/lib/tooltips';

export interface FilterChipsControlsProps {
  subjectCounts: SubjectCounts;
  institutions: { name: string; count: number }[];
  viewCounts: FilterOption[];
  lifeStageCounts: FilterOption[];
  sexCounts: FilterOption[];
  taxonGroupCounts: FilterOption[];
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
  taxonGroupCounts,
}: FilterChipsControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const subject = (params.get('subject') as SubjectValue) ?? 'both';
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

  function setSubject(v: SubjectValue) {
    pushNext((next) => {
      if (v === 'both') next.delete('subject');
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
      <SubjectTypeChips value={subject} counts={subjectCounts} onChange={setSubject} />

      <CollapsibleSection title="what kind of bug?" badge={typeBadge}>
        <Tooltip content={TOOLTIPS.taxonGroup.content} showIcon={false}>
          <TaxonGroupChips
            counts={taxonGroupCounts}
            selected={selectedTypes}
            onChange={makeSetList('type')}
          />
        </Tooltip>
      </CollapsibleSection>

      <CollapsibleSection title="more filters" badge={advancedBadge}>
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
