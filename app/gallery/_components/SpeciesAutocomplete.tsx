'use client';

/**
 * Booru-style multi-tag species search. The user types into the input,
 * picks a result from the dropdown to add it as a tag, and the tag
 * shows as a chip below the input. Multiple tags OR together
 * (gallery rows matching any tag pass the FTS filter).
 *
 * Ported from danbooru-uploader's TagAutocomplete:
 *   - bolded match highlighting inside result names
 *   - k/M count abbreviations
 *   - already-selected results show as disabled ("added")
 *   - keyboard nav skips disabled rows
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { orderColor } from '@/lib/order-colors';

export type SpeciesResult = {
  common_name: string | null;
  taxon_species: string | null;
  taxon_order: string | null;
  count: number;
};

export interface SpeciesAutocompleteProps {
  selected: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}

async function fetchSpecies(q: string, signal: AbortSignal): Promise<SpeciesResult[]> {
  const res = await fetch(`/api/species/search?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) throw new Error('species search failed');
  const body = await res.json();
  return body.results as SpeciesResult[];
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Mark the substring of `name` that matches the current query. <mark>
 *  exposes "highlighted" semantics to assistive tech; <b> would be purely
 *  presentational. */
function highlightMatch(name: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return name;
  const idx = name.toLowerCase().indexOf(q);
  if (idx === -1) return name;
  return (
    <>
      {name.slice(0, idx)}
      <mark>{name.slice(idx, idx + q.length)}</mark>
      {name.slice(idx + q.length)}
    </>
  );
}

export function SpeciesAutocomplete({ selected, onAdd, onRemove }: SpeciesAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [hasFocus, setHasFocus] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const optionIdPrefix = useId();
  const selectedSet = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);

  /** Close the dropdown when focus actually leaves the autocomplete
   *  container — onBlur on the <input> fires before option mousedown
   *  resolves, which is why the prior implementation needed a 200ms
   *  setTimeout. focusout + relatedTarget containment is race-free. */
  function onFocusOut(e: React.FocusEvent<HTMLDivElement>) {
    if (!containerRef.current?.contains(e.relatedTarget as Node | null)) {
      setHasFocus(false);
    }
  }

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

  const results = useMemo(() => {
    const raw = data ?? [];
    return raw.map((r) => {
      const label = r.common_name ?? r.taxon_species ?? '';
      return { ...r, label, disabled: selectedSet.has(label.toLowerCase()) };
    });
  }, [data, selectedSet]);

  const queryInSync = query === debouncedQuery;
  const open =
    hasFocus &&
    debouncedQuery.length >= 2 &&
    results.length > 0 &&
    queryInSync &&
    !isFetching;

  function add(tag: string) {
    if (!tag) return;
    onAdd(tag);
    setQuery('');
    setDebouncedQuery('');
    setActiveIdx(-1);
    inputRef.current?.focus();
  }

  function findNextEnabled(start: number, dir: 1 | -1): number {
    if (results.length === 0) return -1;
    for (let i = 1; i <= results.length; i++) {
      const next = (start + dir * i + results.length) % results.length;
      if (!results[next]!.disabled) return next;
    }
    return -1;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setHasFocus(false);
      setActiveIdx(-1);
      return;
    }
    if (!open) {
      if (e.key === 'Enter' && query.trim()) {
        e.preventDefault();
        add(query.trim());
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = findNextEnabled(activeIdx, 1);
      if (next !== -1) setActiveIdx(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = findNextEnabled(activeIdx, -1);
      if (next !== -1) setActiveIdx(next);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < results.length) {
        const row = results[activeIdx]!;
        if (!row.disabled) add(row.label);
      } else if (query.trim()) {
        add(query.trim());
      }
    } else if (e.key === 'Backspace' && !query && selected.length > 0) {
      // Backspace on empty input pops the last selected chip — natural
      // tag-input pattern.
      onRemove(selected[selected.length - 1]!);
    }
  }

  const activeOptionId =
    activeIdx >= 0 && activeIdx < results.length ? `${optionIdPrefix}-${activeIdx}` : undefined;

  return (
    <div className="species-autocomplete" ref={containerRef} onBlur={onFocusOut}>
      <div className="species-autocomplete-field">
        {selected.map((tag) => (
          <span key={tag} className="species-tag-chip">
            <span className="species-tag-label">{tag}</span>
            <button
              type="button"
              className="species-tag-remove"
              aria-label={`remove ${tag}`}
              onClick={() => onRemove(tag)}
            >
              ×
            </button>
          </span>
        ))}
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
          onKeyDown={onKeyDown}
          placeholder={selected.length === 0 ? 'search species or common name…' : '+ add another'}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
        />
      </div>
      {open && (
        <ul id={listboxId} role="listbox" className="species-autocomplete-dropdown">
          {results.map((r, i) => (
            <li
              key={`${r.common_name ?? ''}-${r.taxon_species ?? ''}-${r.taxon_order ?? ''}-${i}`}
              id={`${optionIdPrefix}-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              aria-disabled={r.disabled}
              className={`species-row${i === activeIdx ? ' active' : ''}${r.disabled ? ' species-row-disabled' : ''}`}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                if (!r.disabled) add(r.label);
              }}
            >
              <span className="species-name" style={{ color: orderColor(r.taxon_order) }}>
                {r.common_name ? highlightMatch(r.common_name, query) : <em>(no common name)</em>}
              </span>
              <span className="species-sci">
                {r.taxon_species ? highlightMatch(r.taxon_species, query) : ''}
              </span>
              <span className="species-count">
                {r.disabled && <span className="species-added">added</span>}
                {formatCount(r.count)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
