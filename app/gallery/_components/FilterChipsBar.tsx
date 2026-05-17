import { listInstitutions } from '@/lib/queries/gallery';
import { getFacetCounts } from '@/lib/queries/facets';
import type { FilterState } from '@/lib/queries/filter-clauses';
import type { AllOrChipsOption } from '@/app/components/filters/AllOrChipsFilter';
import { FilterChipsControls } from './FilterChipsControls';

/**
 * Server component — receives the parsed filter state from the URL via
 * the gallery page, fetches the facet snapshot for it (with own-axis
 * exclusion) plus the institution enum, then hands both to the client
 * controls. Phase C replaced the FilterBar stack with a horizontal row
 * of AllOrChipsFilters; institutions now ride on the same AllOrChips
 * pattern, so we adapt the list into option shape here.
 */
export async function FilterChipsBar({ filters }: { filters: FilterState }) {
  const [snapshot, institutions] = await Promise.all([
    getFacetCounts(filters),
    listInstitutions(),
  ]);

  const institutionOptions: AllOrChipsOption[] = institutions.map((i) => ({
    value: i.name,
    label: i.name,
    count: i.count,
  }));

  return (
    <div className="filter-chips-bar">
      <FilterChipsControls
        initialSubject={filters.subjectType}
        initialFacets={snapshot}
        institutionOptions={institutionOptions}
      />
    </div>
  );
}
