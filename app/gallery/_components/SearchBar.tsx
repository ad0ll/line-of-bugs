'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { SpeciesAutocomplete } from './SpeciesAutocomplete';

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function SearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tags = parseTags(params.get('q'));

  const writeTags = useCallback(
    (next: string[]) => {
      const p = new URLSearchParams(params);
      if (next.length > 0) p.set('q', next.join(','));
      else p.delete('q');
      p.delete('page');
      router.push(`${pathname}?${p.toString()}`);
    },
    [params, router, pathname],
  );

  function onAdd(tag: string) {
    const t = tag.trim();
    if (!t || tags.includes(t)) return;
    writeTags([...tags, t]);
  }

  function onRemove(tag: string) {
    writeTags(tags.filter((x) => x !== tag));
  }

  return (
    <SpeciesAutocomplete
      selected={tags}
      onAdd={onAdd}
      onRemove={onRemove}
    />
  );
}
