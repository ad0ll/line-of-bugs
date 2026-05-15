import { searchGallery } from '@/lib/queries/gallery';
import { GridTile } from './GridTile';

export interface GalleryGridProps {
  q: string;
  subject: 'nature' | 'specimen' | 'both';
  institutions: string[];
  page: number;
}

export async function GalleryGrid({ q, subject, institutions, page }: GalleryGridProps) {
  const { rows, totalCount, hasMore } = await searchGallery({ q, subject, institutions, page });

  if (totalCount === 0) {
    return (
      <div className="gallery-empty">
        <p>no results — try a broader search or fewer filters</p>
      </div>
    );
  }

  return (
    <>
      <p className="gallery-result-count">
        {rows.length} of {totalCount} images
      </p>
      <div className="gallery-grid" id="gallery-grid">
        {rows.map((row) => (
          <GridTile key={row.image_id} row={row} />
        ))}
      </div>
      {hasMore && (
        <a
          className="gallery-load-more"
          href={`/gallery?${new URLSearchParams({
            q,
            subject,
            inst: institutions.join(','),
            page: String(page + 1),
          })}`}
        >
          load more
        </a>
      )}
    </>
  );
}
