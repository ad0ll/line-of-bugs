"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./WhatIsBugFilter.module.css";

interface SearchResult {
  kind: "group" | "species";
  value: string;
  label: string;
  count: number;
}

export interface WhatIsBugFilterProps {
  /** Selected taxon-group chip keys (e.g. "butterflies"). */
  selectedGroups: string[];
  /** Selected species tags (booru-style, FTS5 search). */
  selectedSpecies: string[];
  onGroupsChange: (next: string[]) => void;
  onSpeciesChange: (next: string[]) => void;
  /** Total image count when no filter set — shown in the empty chip. */
  totalCount: number;
}

export function WhatIsBugFilter({
  selectedGroups,
  selectedSpecies,
  onGroupsChange,
  onSpeciesChange,
  totalCount,
}: WhatIsBugFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Fetch search results, debounced
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(`/api/search/insect?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d: { results: SearchResult[] }) => setResults(d.results))
        .catch(() => { /* ignore aborts */ });
    }, 120);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [query]);

  const isEmpty = selectedGroups.length === 0 && selectedSpecies.length === 0;

  function pickResult(r: SearchResult) {
    if (r.kind === "group") {
      if (!selectedGroups.includes(r.value)) {
        onGroupsChange([...selectedGroups, r.value]);
      }
    } else {
      if (!selectedSpecies.includes(r.value)) {
        onSpeciesChange([...selectedSpecies, r.value]);
      }
    }
    setQuery("");
    inputRef.current?.focus();
  }

  function removeGroup(v: string) {
    onGroupsChange(selectedGroups.filter((g) => g !== v));
  }
  function removeSpecies(v: string) {
    onSpeciesChange(selectedSpecies.filter((s) => s !== v));
  }

  return (
    <div ref={containerRef} className={styles.wrap}>
      {isEmpty ? (
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`all bug types · ${totalCount.toLocaleString()}`}
          className={`${styles.chip} ${styles.empty} ${open ? styles.open : ""}`}
          onClick={() => setOpen((o) => !o)}
        >
          all bug types · {totalCount.toLocaleString()} <span aria-hidden>⌄</span>
        </button>
      ) : (
        <div className={styles.chipWall}>
          {selectedGroups.map((g) => (
            <span key={`g-${g}`} className={`${styles.chip} ${styles.selectedGroup}`}>
              <span className={styles.kindBadge}>group</span>
              <span>{g}</span>
              <button type="button" aria-label={`remove ${g}`} className={styles.removeBtn} onClick={() => removeGroup(g)}>×</button>
            </span>
          ))}
          {selectedSpecies.map((s) => (
            <span key={`s-${s}`} className={`${styles.chip} ${styles.selectedSpecies}`}>
              <span className={styles.kindBadge}>species</span>
              <span>{s}</span>
              <button type="button" aria-label={`remove ${s}`} className={styles.removeBtn} onClick={() => removeSpecies(s)}>×</button>
            </span>
          ))}
          <button type="button" aria-label="add another" className={`${styles.chip} ${styles.addBtn}`} onClick={() => setOpen(true)}>
            + add another
          </button>
        </div>
      )}

      {open && (
        <div className={styles.picker}>
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="type a bug type or species…"
            className={styles.search}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          />
          <ul role="listbox" className={styles.list}>
            {results.map((r) => (
              <li
                key={`${r.kind}-${r.value}`}
                role="option"
                aria-selected={false}
                className={styles.row}
                onClick={() => pickResult(r)}
              >
                <span className={styles.kindBadge}>{r.kind}</span>
                <span className={styles.rowLabel}>{r.label}</span>
                <span className={styles.rowCount}>{r.count.toLocaleString()}</span>
              </li>
            ))}
            {query && results.length === 0 && <li className={styles.empty}>no matches</li>}
            {!query && <li className={styles.empty}>start typing to see suggestions</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
