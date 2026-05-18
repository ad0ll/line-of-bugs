import { Suspense } from 'react';
import Link from 'next/link';
import { FilterChipsBar } from './_components/FilterChipsBar';
import { GalleryGrid } from './_components/GalleryGrid';
import { HoverZoomMount } from './_components/HoverZoomMount';
import { parseSubject } from '@/lib/subject';
import { GalleryIcon } from '@/app/components/icons';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readArg<T extends string>(v: string | string[] | undefined, fallback: T): T | string {
  if (Array.isArray(v)) return v[0] ?? fallback;
  return v ?? fallback;
}

function readList(v: string | string[] | undefined): string[] {
  const raw = Array.isArray(v) ? v[0] : v;
  if (!raw) return [];
  return raw.split(',').filter(Boolean);
}

/** Parse the booru-style multi-tag search param. Comma separates tags;
 *  empty strings dropped. "monarch,butterfly" → ["monarch", "butterfly"]. */
function parseQTags(raw: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export default async function GalleryPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = parseQTags(readArg(sp.q, ''));
  const subjectRaw = Array.isArray(sp.subject) ? sp.subject[0] : sp.subject;
  const subject = parseSubject(subjectRaw);
  const institutions = readList(sp.inst);
  const views = readList(sp.view);
  const lifeStages = readList(sp.life);
  const sexes = readList(sp.sex);
  const groups = readList(sp.type);
  const pageRaw = readArg(sp.page, '1') as string;
  // Cap page to keep the SQLite OFFSET bounded (see api/gallery/page/[n]).
  const page = Math.max(1, Math.min(2000, parseInt(pageRaw, 10) || 1));

  const filterState = {
    subjectType: subject,
    views,
    lifeStages,
    sexes,
    groups,
    institutions,
  };

  return (
    <main className="gallery-page">
      <header className="gallery-header">
        <Link href="/" className="gallery-back-link" aria-label="back to home">
          <span aria-hidden>←</span> back
        </Link>
        <h1 className="gallery-title">
          gallery <GalleryIcon size={36} className="gallery-title-icon" loading="eager" />
        </h1>
        {/* Species search lives inside FilterBar (species mode); no
            separate SearchBar — the two were writing to the same `?q=`
            param and the user wanted a unified entry point. */}
        <Suspense fallback={<FilterBarSkeleton />}>
          <FilterChipsBar filters={filterState} />
        </Suspense>
      </header>

      <Suspense fallback={<GallerySkeleton />}>
        <GalleryGrid
          q={q}
          subject={subject}
          institutions={institutions}
          views={views}
          lifeStages={lifeStages}
          sexes={sexes}
          groups={groups}
          page={page}
        />
      </Suspense>

      <HoverZoomMount />
    </main>
  );
}

function GallerySkeleton() {
  return (
    <div className="gallery-grid skeleton">
      {Array.from({ length: 24 }, (_, i) => (
        <div key={i} className="grid-item skeleton-tile" />
      ))}
    </div>
  );
}

// Mirrors the real FilterBar shape (4 rows) so hydration doesn't visibly
// shift content. Wide first row = subject chips, mid row = mode toggle +
// label, wide row = picker chip wall, narrow trailing pill = "more filters".
function FilterBarSkeleton() {
  return (
    <div className="gallery-filters-skeleton" aria-hidden>
      <div className="gallery-filters-skeleton-row gallery-filters-skeleton-row--wide" />
      <div className="gallery-filters-skeleton-row gallery-filters-skeleton-row--mid" />
      <div className="gallery-filters-skeleton-row gallery-filters-skeleton-row--wide" />
      <div className="gallery-filters-skeleton-row gallery-filters-skeleton-row--narrow" />
    </div>
  );
}
