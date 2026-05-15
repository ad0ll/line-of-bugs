import { listInstitutions, listSubjectTypeCounts } from '@/lib/queries/gallery';
import { FilterChipsControls } from './FilterChipsControls';

export async function FilterChipsBar() {
  const [subjectCounts, institutions] = await Promise.all([
    listSubjectTypeCounts(),
    listInstitutions(),
  ]);
  return (
    <div className="filter-chips-bar">
      <FilterChipsControls subjectCounts={subjectCounts} institutions={institutions} />
    </div>
  );
}
