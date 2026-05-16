import Link from 'next/link';
import { searchGallery } from '@/lib/queries/gallery';
import { InfiniteScroller } from './InfiniteScroller';
import type { SubjectType } from '@/lib/subject';

export interface GalleryGridProps {
  q: string[];
  subject: SubjectType;
  institutions: string[];
  views: string[];
  lifeStages: string[];
  sexes: string[];
  groups: string[];
  page: number;
}

export async function GalleryGrid({
  q, subject, institutions, views, lifeStages, sexes, groups, page,
}: GalleryGridProps) {
  const initial = await searchGallery({
    q, subject, institutions, views, lifeStages, sexes, groups, page,
  });

  if (initial.totalCount === 0) {
    return (
      <div className="gallery-empty">
        <div className="gallery-empty-icon" aria-hidden>✿</div>
        <p className="gallery-empty-title">no bugs found here</p>
        <p className="gallery-empty-hint">try a broader search or fewer filters</p>
        <Link href="/gallery" className="gallery-load-more is-inline">
          clear filters
        </Link>
      </div>
    );
  }

  // Stable identity for the filter set — drives InfiniteScroller's
  // reset effect. Joining sorted arrays keeps the key independent of
  // chip-click order so toggling on/off doesn't churn pages needlessly.
  const filterKey = [
    q.join(","),
    subject,
    [...institutions].sort().join(","),
    [...views].sort().join(","),
    [...lifeStages].sort().join(","),
    [...sexes].sort().join(","),
    [...groups].sort().join(","),
  ].join("|");

  return (
    <>
      <p className="gallery-result-count">
        {initial.totalCount.toLocaleString()} bugs
      </p>
      <InfiniteScroller
        initial={initial}
        q={q}
        subject={subject}
        institutions={institutions}
        views={views}
        lifeStages={lifeStages}
        sexes={sexes}
        groups={groups}
        filterKey={filterKey}
      />
    </>
  );
}
