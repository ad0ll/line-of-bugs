'use client';

/**
 * R6 "what kind of bug?" chip wall — multi-select multi-row flex of
 * buttons keyed to lib/taxonomy.ts. Empty selection = all bugs (no
 * filter applied). Optional staggered fade-in handled in CSS via
 * --i custom property when the parent is data-open=true.
 *
 * Chips with a `tooltip` field in TAXON_GROUPS (e.g., aphids, stick
 * insects) pass it through to the shared <Chip>; the rest pass
 * `tooltip={null}` — both paths are forced at the type level.
 *
 * Counts come from the merged facet snapshot — `count` is the filtered
 * count (every other axis applied, this axis ignored), `total` is the
 * absolute unfiltered count. Zero-filtered chips render greyed so the
 * user sees that clicking them won't help given the current other-axis
 * filters. Zero-total chips (data we never had) stay hidden.
 */
import { TAXON_GROUPS } from '@/lib/taxonomy';
import type { FilterOption } from '@/app/components/filters/FilterPopover';
import { Chip } from '@/app/components/ui/Chip';

export interface TaxonGroupChipsProps {
  /** Per-chip counts keyed by chip `name`. From the facet snapshot. */
  counts: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export function TaxonGroupChips({ counts, selected, onChange }: TaxonGroupChipsProps) {
  const byKey = new Map(counts.map((c) => [c.name, c]));

  function toggle(key: string) {
    const set = new Set(selected);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    onChange([...set]);
  }

  return (
    <div className="taxon-group-chips" role="group" aria-label="filter by what kind of bug">
      {TAXON_GROUPS.map((g, i) => {
        const opt = byKey.get(g.key);
        // No total → no data ever for this chip; hide it permanently.
        const total = opt?.total ?? opt?.count;
        if (total === undefined || total === 0) return null;
        const filtered = opt?.count ?? 0;
        return (
          <Chip
            key={g.key}
            label={g.label}
            count={filtered}
            total={total}
            active={selected.includes(g.key)}
            disabled={filtered === 0}
            tooltip={g.tooltip ?? null}
            onClick={() => toggle(g.key)}
            className="taxon-group-chip"
            style={{ ['--i' as string]: i }}
          />
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
