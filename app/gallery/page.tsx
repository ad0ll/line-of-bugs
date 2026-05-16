import { Suspense } from 'react';
import { SearchBar } from './_components/SearchBar';
import { FilterChipsBar } from './_components/FilterChipsBar';
import { GalleryGrid } from './_components/GalleryGrid';
import { HoverZoomMount } from './_components/HoverZoomMount';
import { parseSubject } from '@/lib/subject';

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
  const page = Math.max(1, parseInt(pageRaw, 10) || 1);

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
        <h1>gallery</h1>
        <SearchBar />
        <Suspense fallback={<div className="gallery-filters-skeleton" />}>
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
