import {
  listInstitutions,
  listSubjectTypeCounts,
  listViewCounts,
  listLifeStageCounts,
  listSexCounts,
} from '@/lib/queries/gallery';
import { FilterChipsControls } from './FilterChipsControls';

export async function FilterChipsBar() {
  const [subjectCounts, institutions, views, lifeStages, sexes] = await Promise.all([
    listSubjectTypeCounts(),
    listInstitutions(),
    listViewCounts(),
    listLifeStageCounts(),
    listSexCounts(),
  ]);
  return (
    <div className="filter-chips-bar">
      <FilterChipsControls
        subjectCounts={subjectCounts}
        institutions={institutions}
        viewCounts={views}
        lifeStageCounts={lifeStages}
        sexCounts={sexes}
      />
    </div>
  );
}
