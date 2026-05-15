'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { SpeciesAutocomplete } from './SpeciesAutocomplete';

export function SearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get('q') ?? '';

  function onSelect(next: string) {
    const p = new URLSearchParams(params);
    if (next) p.set('q', next);
    else p.delete('q');
    p.delete('page');
    router.push(`${pathname}?${p.toString()}`);
  }

  return <SpeciesAutocomplete value={q} onSelect={onSelect} />;
}
