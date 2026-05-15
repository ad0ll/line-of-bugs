import { searchGallery } from '@/lib/queries/gallery';
import { InfiniteScroller } from './InfiniteScroller';

export interface GalleryGridProps {
  q: string;
  subject: 'nature' | 'specimen' | 'both';
  institutions: string[];
  page: number;
}

export async function GalleryGrid({ q, subject, institutions, page }: GalleryGridProps) {
  const initial = await searchGallery({ q, subject, institutions, page });

  if (initial.totalCount === 0) {
    return (
      <div className="gallery-empty">
        <div className="gallery-empty-icon" aria-hidden>✿</div>
        <p style={{ margin: 0, fontFamily: "var(--font-display), serif", fontStyle: "italic", fontSize: "1.2rem", color: "var(--text-secondary)" }}>
          no bugs found here
        </p>
        <p style={{ margin: 0, fontSize: "0.9rem" }}>
          try a broader search or fewer filters
        </p>
        <a href="/gallery" className="gallery-load-more" style={{ margin: 0 }}>
          ✿ clear filters
        </a>
      </div>
    );
  }

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
      />
    </>
  );
}
