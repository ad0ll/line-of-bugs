import { listInstitutions } from '@/lib/queries/gallery';
import { getFacetCounts, getUnfilteredFacets, type FacetCount } from '@/lib/queries/facets';
import type { FilterState } from '@/lib/queries/filter-clauses';
import { FilterChipsControls, type SubjectCountPair } from './FilterChipsControls';
import type { FilterOption } from '@/app/components/filters/FilterPopover';

/**
 * Server component — receives the parsed filter state from the URL
 * via the gallery page, fetches the facet snapshot for it (with
 * own-axis exclusion), and the unfiltered "totals" snapshot, then
 * passes both shapes to the client controls.
 */
export async function FilterChipsBar({ filters }: { filters: FilterState }) {
  const [filtered, totals, institutions] = await Promise.all([
    getFacetCounts(filters),
    getUnfilteredFacets(),
    listInstitutions(),
  ]);

  const subject: SubjectCountPair = {
    filtered: filtered.subject,
    totals: totals.subject,
  };

  return (
    <div className="filter-chips-bar">
      <FilterChipsControls
        subject={subject}
        institutions={institutions}
        viewCounts={mergeFacet(filtered.views, totals.views)}
        lifeStageCounts={mergeFacet(filtered.lifeStages, totals.lifeStages)}
        sexCounts={mergeFacet(filtered.sexes, totals.sexes)}
        taxonGroupCounts={mergeFacet(filtered.taxonGroups, totals.taxonGroups)}
      />
    </div>
  );
}

function mergeFacet(filtered: FacetCount[], totals: FacetCount[]): FilterOption[] {
  const byName = new Map(filtered.map((f) => [f.name, f.count]));
  return totals.map((t) => ({
    name: t.name,
    count: byName.get(t.name) ?? 0,
    total: t.count,
  }));
}
