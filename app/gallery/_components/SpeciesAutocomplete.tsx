'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { orderColor } from '@/lib/order-colors';

export type SpeciesResult = {
  common_name: string | null;
  taxon_species: string | null;
  taxon_order: string | null;
  count: number;
};

export interface SpeciesAutocompleteProps {
  value: string;
  onSelect: (q: string) => void;
}

async function fetchSpecies(q: string, signal: AbortSignal): Promise<SpeciesResult[]> {
  const url = `/api/species/search?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('species search failed');
  const body = await res.json();
  return body.results as SpeciesResult[];
}

export function SpeciesAutocomplete({ value, onSelect }: SpeciesAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [debouncedQuery, setDebouncedQuery] = useState(value);
  const [hasFocus, setHasFocus] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const optionIdPrefix = useId();

  useEffect(() => {
    setQuery(value);
    setDebouncedQuery(value);
  }, [value]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ['species', debouncedQuery],
    queryFn: ({ signal }) => fetchSpecies(debouncedQuery, signal),
    enabled: debouncedQuery.length >= 2,
    placeholderData: undefined,
  });

  const results = data ?? [];
  const queryInSync = query === debouncedQuery;
  const open = hasFocus && debouncedQuery.length >= 2 && results.length > 0 && queryInSync && !isFetching;

  function selectQ(q: string) {
    onSelect(q);
    setActiveIdx(-1);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setHasFocus(false);
      setActiveIdx(-1);
      return;
    }
    if (!open) {
      if (e.key === 'Enter') {
        e.preventDefault();
        selectQ(query.trim());
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < results.length) {
        const row = results[activeIdx]!;
        selectQ(row.common_name ?? row.taxon_species ?? query.trim());
      } else {
        selectQ(query.trim());
      }
    }
  }

  const activeOptionId =
    activeIdx >= 0 && activeIdx < results.length ? `${optionIdPrefix}-${activeIdx}` : undefined;

  return (
    <div className="species-autocomplete">
      <input
        ref={inputRef}
        type="text"
        className="species-autocomplete-input"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIdx(-1);
        }}
        onFocus={() => setHasFocus(true)}
        onBlur={() => setTimeout(() => setHasFocus(false), 200)}
        onKeyDown={onKeyDown}
        placeholder="search species or common name…"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
      />
      {open && (
        <ul id={listboxId} role="listbox" className="species-autocomplete-dropdown">
          {results.map((r, i) => (
            <li
              key={`${r.common_name}-${r.taxon_species}`}
              id={`${optionIdPrefix}-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              className={`species-row ${i === activeIdx ? 'active' : ''}`}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                selectQ(r.common_name ?? r.taxon_species ?? query.trim());
              }}
            >
              <span className="species-name" style={{ color: orderColor(r.taxon_order) }}>
                {r.common_name ?? '(no common name)'}
              </span>
              <span className="species-sci">{r.taxon_species}</span>
              <span className="species-count">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
