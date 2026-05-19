"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./WhatIsBugFilter.module.css";

function ChevronDown() {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      className={styles.chevron}
    >
      <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
}

function summaryLabel(groups: string[], species: string[]): string {
  const n = groups.length + species.length;
  if (n === 0) return "all bug types";
  if (n === 1) return "1 bug type";
  return `${n} bug types`;
}

export function WhatIsBugFilter({
  selectedGroups,
  selectedSpecies,
  onGroupsChange,
  onSpeciesChange,
}: WhatIsBugFilterProps) {
  const pickerId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  // Keyboard-nav cursor into the visible candidate list (W-1 a11y). -1
  // means no row is active yet; Arrow keys walk through visibleResults
  // and Enter picks the active row.
  const [activeIdx, setActiveIdx] = useState(-1);
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

  // Reset search query + cursor when the picker closes (W-7). Without
  // this, reopening with a prior query value briefly flashes stale
  // search results instead of the default all-groups list.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIdx(-1);
    }
  }, [open]);

  // Lock body scroll on the mobile bottom sheet (audit re-check). Gated on
  // ≤640px so desktop hover-popover usage is unaffected.
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 640px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Fetch search results when the picker is open. Empty query is allowed
  // — the backend returns the all-groups list so the dropdown shows
  // candidates immediately, matching AllOrChipsFilter behavior.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(`/api/search/insect?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d: { results: SearchResult[] }) => setResults(d.results))
        .catch(() => { /* ignore aborts */ });
    }, 120);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [query, open]);

  const totalSelected = selectedGroups.length + selectedSpecies.length;
  const chipLabel = summaryLabel(selectedGroups, selectedSpecies);

  // Hide already-selected rows from the dropdown so the keyboard cursor
  // doesn't have to skip them and so the visible index matches activeIdx.
  const visibleResults = results.filter(
    (r) =>
      (r.kind === "group" && !selectedGroups.includes(r.value)) ||
      (r.kind === "species" && !selectedSpecies.includes(r.value)),
  );

  // Reset cursor when the visible list size changes (e.g., user typed,
  // results refetched, or a selection just removed a row).
  useEffect(() => {
    setActiveIdx((i) => (i >= visibleResults.length ? -1 : i));
  }, [visibleResults.length]);

  function pickResult(r: SearchResult) {
    if (r.kind === "group") {
      if (!selectedGroups.includes(r.value)) onGroupsChange([...selectedGroups, r.value]);
    } else {
      if (!selectedSpecies.includes(r.value)) onSpeciesChange([...selectedSpecies, r.value]);
    }
    setQuery("");
    setActiveIdx(-1);
    inputRef.current?.focus();
  }

  function onDialogKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") {
      if (visibleResults.length === 0) return;
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, visibleResults.length - 1));
    } else if (e.key === "ArrowUp") {
      if (visibleResults.length === 0) return;
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? 0 : i - 1));
    } else if (e.key === "Enter") {
      if (activeIdx >= 0 && activeIdx < visibleResults.length) {
        e.preventDefault();
        pickResult(visibleResults[activeIdx]!);
      }
    }
  }

  function removeGroup(v: string) {
    onGroupsChange(selectedGroups.filter((g) => g !== v));
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function removeSpecies(v: string) {
    onSpeciesChange(selectedSpecies.filter((s) => s !== v));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div ref={containerRef} className={styles.wrap}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={pickerId}
        aria-label={chipLabel}
        className={`${styles.chip} ${totalSelected === 0 ? styles.empty : styles.selectedSummary} ${open ? styles.open : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        {chipLabel}
        <ChevronDown />
      </button>

      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            className={styles.picker}
            id={pickerId}
            role="dialog"
            onKeyDown={onDialogKeyDown}
          >
            <div className={styles.sheetHandle} aria-hidden="true" />

            {totalSelected > 0 && (
              <div className={styles.selectionsZone}>
                <div className={styles.selectionsHeader}>selected ({totalSelected})</div>
                <div className={styles.selectionsList}>
                  {selectedGroups.map((g) => (
                    <span key={`g-${g}`} className={styles.selectionChip}>
                      <span className={styles.kindBadge}>group</span>
                      <span>{g}</span>
                      <button
                        type="button"
                        aria-label={`remove ${g}`}
                        className={styles.removeBtn}
                        onClick={() => removeGroup(g)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {selectedSpecies.map((s) => (
                    <span key={`s-${s}`} className={styles.selectionChip}>
                      <span className={styles.kindBadge}>species</span>
                      <span>{s}</span>
                      <button
                        type="button"
                        aria-label={`remove ${s}`}
                        className={styles.removeBtn}
                        onClick={() => removeSpecies(s)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <input
              ref={inputRef}
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="type to search bugs…"
              className={styles.search}
            />

            <div className={styles.candidatesHeader}>
              {query ? "search results" : "bug types"}
            </div>
            <ul role="listbox" className={styles.list}>
              {visibleResults.map((r, idx) => (
                <li
                  key={`${r.kind}-${r.value}`}
                  role="option"
                  aria-selected={idx === activeIdx}
                  className={`${styles.row} ${idx === activeIdx ? styles.rowActive : ""}`}
                  onClick={() => pickResult(r)}
                  onMouseEnter={() => setActiveIdx(idx)}
                >
                  <span className={styles.kindBadge}>{r.kind}</span>
                  <span className={styles.rowLabel}>{r.label}</span>
                  <span className={styles.rowCount}>{r.count.toLocaleString()}</span>
                </li>
              ))}
              {visibleResults.length === 0 && (
                <li className={styles.empty}>
                  {query ? "no matches" : "loading…"}
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
