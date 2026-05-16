'use client';

/**
 * Unified filter bar shared by home + gallery. Replaces the divergent
 * stacks (Home: SubjectFilter + three FilterPopovers; Gallery:
 * SubjectTypeChips + InstitutionPicker + three FilterPopovers).
 *
 * Layout (top → bottom):
 *   1. Subject row     — single-select pill chips: all | wild | captive | specimen
 *   2. Mode toggle     — "categories" / "species" — swaps row 3 between
 *      the layperson taxon chip wall and the booru-style multi-tag
 *      species autocomplete. Same vertical footprint either way.
 *   3. Primary picker  — chip wall or autocomplete (per toggle). Linked
 *      to the active mode tab via aria-labelledby + role="tabpanel".
 *   4. More filters    — trailing popover trigger; opens a panel
 *      with the secondary axes (view / life-stage / sex + optional
 *      institution on gallery). Always present in DOM (hidden when
 *      closed) so aria-controls always resolves; outside-click closes.
 *
 * Parents own URL routing via the onChange callbacks.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
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
  /** Active picker mode. Parents own URL persistence — pass `'species'`
   *  / `'chips'` from `?mode=`, falling back to `species.length > 0`. */
  mode: FilterMode;
}

/** Default mode when the URL doesn't explicitly carry `?mode=`. Species
 *  tags imply species mode; otherwise start with the chip wall. */
export function defaultMode(species: string[]): FilterMode {
  return species.length > 0 ? 'species' : 'chips';
}

/** Parse `?mode=` to a FilterMode, falling back to `defaultMode(species)`
 *  when the param is missing or unrecognized. */
export function parseMode(raw: string | null, species: string[]): FilterMode {
  if (raw === 'species' || raw === 'chips') return raw;
  return defaultMode(species);
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
  const mode = state.mode;

  // Stable ids for the tab → tabpanel ARIA relationship. APG dictates
  // each tab carries aria-controls pointing at the panel, and the panel
  // is aria-labelledby its active tab.
  const baseId = useId();
  const chipsTabId = `${baseId}-tab-chips`;
  const speciesTabId = `${baseId}-tab-species`;
  const panelId = `${baseId}-panel`;
  const chipsTabRef = useRef<HTMLButtonElement>(null);
  const speciesTabRef = useRef<HTMLButtonElement>(null);

  // Automatic activation: arrow keys both move focus AND activate the tab,
  // matching the existing onClick behavior. Roving tabindex keeps Tab key
  // navigation predictable (only the active tab is in tab order).
  function activateMode(next: FilterMode) {
    if (next !== mode) onChange({ mode: next });
    const ref = next === 'chips' ? chipsTabRef : speciesTabRef;
    ref.current?.focus();
  }

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    const other: FilterMode = mode === 'chips' ? 'species' : 'chips';
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        activateMode(other);
        break;
      case 'Home':
        e.preventDefault();
        activateMode('chips');
        break;
      case 'End':
        e.preventDefault();
        activateMode('species');
        break;
    }
  }

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

  const activeTabId = mode === 'chips' ? chipsTabId : speciesTabId;

  return (
    <div className="filter-bar">
      {/* Row 1: Subject (single-select). "all" first.
          role="group" rather than "radiogroup": the children are toggle-
          button Chips (aria-pressed), not radios — using radiogroup here
          previously created a semantic mismatch. */}
      <div className="filter-bar-row">
        <Tooltip content={TOOLTIPS.subject.content} iconLabel="more info about subject type">
          <span className="filter-bar-label">subject</span>
        </Tooltip>
        <div className="filter-bar-chips" role="group" aria-label="subject type">
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

      {/* "kind" row — label + a controls column that stacks the mode
          toggle directly above its tabpanel. Visually associates the
          label with both controls (the audit's M7 concern: previously
          the picker appeared label-less below row 2). Arrow keys +
          Home/End move and activate the tab; Tab key only enters the
          active tab (roving tabindex). */}
      <div className="filter-bar-row filter-bar-kind">
        <Tooltip content={TOOLTIPS.taxonGroup.content} iconLabel="more info about kind of bug">
          <span className="filter-bar-label">kind</span>
        </Tooltip>
        <div className="filter-bar-kind-controls">
          <div className="filter-bar-mode" role="tablist" aria-label="kind of bug filter mode">
            <button
              ref={chipsTabRef}
              id={chipsTabId}
              type="button"
              role="tab"
              aria-selected={mode === 'chips'}
              aria-controls={panelId}
              tabIndex={mode === 'chips' ? 0 : -1}
              className={`filter-bar-mode-tab${mode === 'chips' ? ' is-active' : ''}`}
              onClick={() => activateMode('chips')}
              onKeyDown={onTabKeyDown}
            >
              categories
            </button>
            <button
              ref={speciesTabRef}
              id={speciesTabId}
              type="button"
              role="tab"
              aria-selected={mode === 'species'}
              aria-controls={panelId}
              tabIndex={mode === 'species' ? 0 : -1}
              className={`filter-bar-mode-tab${mode === 'species' ? ' is-active' : ''}`}
              onClick={() => activateMode('species')}
              onKeyDown={onTabKeyDown}
            >
              species
            </button>
          </div>
          <div
            id={panelId}
            className="filter-bar-picker"
            data-mode={mode}
            role="tabpanel"
            aria-labelledby={activeTabId}
            tabIndex={0}
          >
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
        </div>
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
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape dismissal at the wrapper level — without this,
  // opening "more filters" and clicking elsewhere leaves the panel open.
  // The inner FilterPopovers already self-close on outside click, but the
  // disclosure container needs its own listener.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  return (
    <div className="filter-bar-more" ref={wrapRef}>
      <button
        type="button"
        className={`chip${activeCount > 0 ? ' chip-active' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {/* Always rendered + `hidden` when closed so aria-controls always
          resolves (mirrors FilterPopover's pattern). */}
      <div
        id={panelId}
        className="filter-bar-more-row"
        role="group"
        aria-label="advanced filters"
        hidden={!open}
      >
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
    </div>
  );
}
