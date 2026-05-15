import {
  listInstitutions,
  listSubjectTypeCounts,
  listViewCounts,
  listLifeStageCounts,
  listSexCounts,
  listTaxonGroupCounts,
} from '@/lib/queries/gallery';
import { FilterChipsControls } from './FilterChipsControls';

export async function FilterChipsBar() {
  const [subjectCounts, institutions, views, lifeStages, sexes, taxonGroups] = await Promise.all([
    listSubjectTypeCounts(),
    listInstitutions(),
    listViewCounts(),
    listLifeStageCounts(),
    listSexCounts(),
    listTaxonGroupCounts(),
  ]);
  return (
    <div className="filter-chips-bar">
      <FilterChipsControls
        subjectCounts={subjectCounts}
        institutions={institutions}
        viewCounts={views}
        lifeStageCounts={lifeStages}
        sexCounts={sexes}
        taxonGroupCounts={taxonGroups}
      />
    </div>
  );
}
