'use client';

/**
 * Unified filter bar shared by home + gallery. Replaces the divergent
 * stacks (Home: SubjectFilter + CollapsibleSection + TaxonGroupChips +
 * three FilterPopovers; Gallery: SubjectTypeChips + CollapsibleSection
 * + TaxonGroupChips + InstitutionPicker + three FilterPopovers).
 *
 * Layout (top → bottom):
 *   1. Subject row     — single-select pill chips: all | wild | captive | specimen
 *   2. Mode toggle     — "chips" / "species" — swaps row 3 between
 *      the layperson taxon chip wall and the booru-style multi-tag
 *      species autocomplete. Same vertical footprint either way.
 *   3. Primary picker  — chip wall or autocomplete (per toggle).
 *   4. More filters    — trailing popover trigger; opens a panel
 *      with the secondary axes (view / life-stage / sex + optional
 *      institution on gallery).
 *
 * No collapsibles. All controls are in-flow. Parents own URL routing
 * via the onChange callbacks.
 */
import { useState } from 'react';
import { Chip } from '@/app/components/ui/Chip';
import { TaxonGroupChips } from '@/app/components/filters/TaxonGroupChips';
import { FilterPopover, type FilterOption } from '@/app/components/filters/FilterPopover';
import { SpeciesAutocomplete } from '@/app/gallery/_components/SpeciesAutocomplete';
import { Tooltip } from '@/app/components/ui/Tooltip';
import { TOOLTIPS } from '@/lib/tooltips';
import type { SubjectType } from '@/lib/subject';

export type FilterMode = 'chips' | 'species';

export interface FilterBarState {
  subject: SubjectType;
  groups: string[];
  species: string[];
  views: string[];
  lifeStages: string[];
  sexes: string[];
  institutions: string[];
}

export interface FilterBarOptions {
  taxonGroups: FilterOption[];
  views: FilterOption[];
  lifeStages: FilterOption[];
  sexes: FilterOption[];
  /** Pass `undefined` to hide the institution row (home does this). */
  institutions?: { name: string; count: number }[];
  /** Per-subject filtered+total counts for the subject row. */
  subjectCounts: {
    filtered: { wild: number; captive: number; specimen: number; all: number };
    totals:   { wild: number; captive: number; specimen: number; all: number };
  };
}

export interface FilterBarProps {
  state: FilterBarState;
  options: FilterBarOptions;
  onChange: (next: Partial<FilterBarState>) => void;
}

const SUBJECT_ORDER: SubjectType[] = ['all', 'wild', 'captive', 'specimen'];

export function FilterBar({ state, options, onChange }: FilterBarProps) {
  const [mode, setMode] = useState<FilterMode>(state.species.length > 0 ? 'species' : 'chips');

  function setSubject(v: SubjectType) {
    onChange({ subject: v });
  }

  function setGroups(next: string[]) {
    onChange({ groups: next });
  }

  function addSpecies(tag: string) {
    if (state.species.includes(tag)) return;
    onChange({ species: [...state.species, tag] });
  }

  function removeSpecies(tag: string) {
    onChange({ species: state.species.filter((t) => t !== tag) });
  }

  const moreActiveCount =
    state.views.length +
    state.lifeStages.length +
    state.sexes.length +
    state.institutions.length;

  return (
    <div className="filter-bar">
      {/* Row 1: Subject (single-select). "all" first. */}
      <div className="filter-bar-row">
        <Tooltip content={TOOLTIPS.subject.content}>
          <span className="filter-bar-label">subject</span>
        </Tooltip>
        <div className="filter-bar-chips" role="radiogroup" aria-label="subject type">
          {SUBJECT_ORDER.map((v) => (
            <Chip
              key={v}
              label={v}
              count={options.subjectCounts.filtered[v]}
              total={options.subjectCounts.totals[v]}
              active={state.subject === v}
              disabled={options.subjectCounts.filtered[v] === 0 && v !== 'all'}
              tooltip={null}
              onClick={() => setSubject(v)}
              ariaPressed={state.subject === v}
            />
          ))}
        </div>
      </div>

      {/* Row 2: Mode toggle + Row 3: primary picker */}
      <div className="filter-bar-row">
        <Tooltip content={TOOLTIPS.taxonGroup.content}>
          <span className="filter-bar-label">kind</span>
        </Tooltip>
        <div className="filter-bar-mode" role="tablist" aria-label="kind of bug filter mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'chips'}
            className={`filter-bar-mode-tab${mode === 'chips' ? ' is-active' : ''}`}
            onClick={() => setMode('chips')}
          >
            categories
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'species'}
            className={`filter-bar-mode-tab${mode === 'species' ? ' is-active' : ''}`}
            onClick={() => setMode('species')}
          >
            species
          </button>
        </div>
      </div>

      <div className="filter-bar-picker" data-mode={mode}>
        {mode === 'chips' ? (
          <TaxonGroupChips
            counts={options.taxonGroups}
            selected={state.groups}
            onChange={setGroups}
          />
        ) : (
          <SpeciesAutocomplete
            selected={state.species}
            onAdd={addSpecies}
            onRemove={removeSpecies}
          />
        )}
      </div>

      {/* Row 4: trailing "more filters" popover */}
      <div className="filter-bar-row filter-bar-row-end">
        <FilterBarMore
          state={state}
          options={options}
          onChange={onChange}
          activeCount={moreActiveCount}
        />
      </div>
    </div>
  );
}

interface FilterBarMoreProps {
  state: FilterBarState;
  options: FilterBarOptions;
  onChange: (next: Partial<FilterBarState>) => void;
  activeCount: number;
}

function FilterBarMore({ state, options, onChange, activeCount }: FilterBarMoreProps) {
  const label = activeCount > 0 ? `more filters (${activeCount})` : 'more filters';
  // Reuse FilterPopover anchored to a single trigger — but the
  // popover-each-axis pattern is simpler than packing four into one
  // panel and matches the existing primitive. So we render four
  // popovers inline behind a "more filters ▾" toggle.
  const [open, setOpen] = useState(false);
  return (
    <div className="filter-bar-more">
      <button
        type="button"
        className={`chip${activeCount > 0 ? ' chip-active' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div className="filter-bar-more-row" role="group" aria-label="advanced filters">
          {options.institutions && (
            <FilterPopover
              idleLabel="institution: all"
              selectedLabel={(n) => `institution: ${n}`}
              ariaLabel="institution filter"
              options={options.institutions.map((i) => ({ name: i.name, count: i.count }))}
              selected={state.institutions}
              onChange={(institutions) => onChange({ institutions })}
            />
          )}
          <FilterPopover
            idleLabel="view: all"
            selectedLabel={(n) => `view: ${n}`}
            ariaLabel="view filter"
            options={options.views}
            selected={state.views}
            onChange={(views) => onChange({ views })}
          />
          <FilterPopover
            idleLabel="life stage: all"
            selectedLabel={(n) => `life: ${n}`}
            ariaLabel="life stage filter"
            options={options.lifeStages}
            selected={state.lifeStages}
            onChange={(lifeStages) => onChange({ lifeStages })}
          />
          <FilterPopover
            idleLabel="sex: all"
            selectedLabel={(n) => `sex: ${n}`}
            ariaLabel="sex filter"
            options={options.sexes}
            selected={state.sexes}
            onChange={(sexes) => onChange({ sexes })}
          />
        </div>
      )}
    </div>
  );
}
