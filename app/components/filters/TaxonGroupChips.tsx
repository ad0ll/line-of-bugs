'use client';

/**
 * R6 "what kind of bug?" chip wall — multi-select multi-row flex of
 * buttons keyed to lib/taxonomy.ts. Empty selection = all bugs (no
 * filter applied). Optional staggered fade-in handled in CSS via
 * --i custom property when the parent is data-open=true.
 */
import { TAXON_GROUPS } from '@/lib/taxonomy';
import type { FilterOption } from '@/app/components/filters/FilterPopover';

export interface TaxonGroupChipsProps {
  /** Per-chip counts keyed by chip `name` (matches the chip key). Comes
   *  from listTaxonGroupCounts(). */
  counts: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export function TaxonGroupChips({ counts, selected, onChange }: TaxonGroupChipsProps) {
  const countByKey = new Map(counts.map((c) => [c.name, c.count]));

  function toggle(key: string) {
    const set = new Set(selected);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    onChange([...set]);
  }

  return (
    <div className="taxon-group-chips" role="group" aria-label="filter by what kind of bug">
      {TAXON_GROUPS.map((g, i) => {
        const count = countByKey.get(g.key);
        if (count === undefined || count === 0) return null;
        const active = selected.includes(g.key);
        return (
          <button
            key={g.key}
            type="button"
            className={`chip taxon-group-chip ${active ? 'chip-active' : ''}`}
            aria-pressed={active}
            title={g.tooltip}
            onClick={() => toggle(g.key)}
            style={{ ['--i' as string]: i }}
          >
            <span className="chip-label">{g.label}</span>
            <span className="chip-count">{count.toLocaleString()}</span>
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          type="button"
          className="taxon-group-clear"
          onClick={() => onChange([])}
        >
          clear
        </button>
      )}
    </div>
  );
}
