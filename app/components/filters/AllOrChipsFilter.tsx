"use client";

import { useId, useRef, useState, useEffect } from "react";
import styles from "./AllOrChipsFilter.module.css";

export interface AllOrChipsOption {
  value: string;
  label: string;
  count: number;
}

export interface AllOrChipsFilterProps {
  label: string;
  emptyLabel: string;
  options: AllOrChipsOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;
  searchable?: boolean;
}

export function AllOrChipsFilter({
  label,
  emptyLabel,
  options,
  selected,
  onChange,
  multi = true,
  searchable = true,
}: AllOrChipsFilterProps) {
  const pickerId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const totalCount = options.reduce((a, o) => a + o.count, 0);
  const visibleOptions = options
    .slice()
    .sort((a, b) => b.count - a.count)
    .filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()));

  function toggleOption(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange(multi ? [...selected, value] : [value]);
    }
  }

  return (
    <div ref={containerRef} className={styles.wrap}>
      {selected.length === 0 ? (
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={pickerId}
          aria-label={emptyLabel}
          className={`${styles.chip} ${styles.empty} ${open ? styles.open : ""}`}
          onClick={() => setOpen((o) => !o)}
        >
          {emptyLabel} · {totalCount.toLocaleString()} <span aria-hidden>⌄</span>
        </button>
      ) : (
        <SelectedChips
          label={label}
          options={options}
          selected={selected}
          onRemove={(v) => onChange(selected.filter((x) => x !== v))}
          onAdd={() => setOpen(true)}
        />
      )}

      {open && (
        <Picker
          id={pickerId}
          options={visibleOptions}
          selected={selected}
          onPick={toggleOption}
          search={search}
          onSearch={setSearch}
          searchable={searchable}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function SelectedChips({
  label, options, selected, onRemove, onAdd,
}: {
  label: string;
  options: AllOrChipsOption[];
  selected: string[];
  onRemove: (v: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className={styles.chipWall} aria-label={`${label} selections`}>
      {selected.map((v) => {
        const o = options.find((x) => x.value === v);
        return (
          <span key={v} className={`${styles.chip} ${styles.selected}`}>
            <span>{o?.label ?? v} · {o?.count.toLocaleString() ?? "?"}</span>
            <button
              type="button"
              aria-label={`remove ${o?.label ?? v}`}
              className={styles.removeBtn}
              onClick={() => onRemove(v)}
            >
              ×
            </button>
          </span>
        );
      })}
      <button
        type="button"
        aria-label={`add ${label}`}
        className={`${styles.chip} ${styles.addBtn}`}
        onClick={onAdd}
      >
        + add
      </button>
    </div>
  );
}

function Picker({
  id, options, selected, onPick, search, onSearch, searchable, onClose,
}: {
  id: string;
  options: AllOrChipsOption[];
  selected: string[];
  onPick: (v: string) => void;
  search: string;
  onSearch: (s: string) => void;
  searchable: boolean;
  onClose: () => void;
}) {
  const [activeIdx, setActiveIdx] = useState(-1);
  // Reset active when the option set changes (search filter applied)
  useEffect(() => { setActiveIdx(-1); }, [options.length, search]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => {
        // Skip already-selected (disabled) rows
        let next = Math.min(i + 1, options.length - 1);
        while (next < options.length && selected.includes(options[next]!.value)) next++;
        return next < options.length ? next : i;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => {
        let next = Math.max(i - 1, 0);
        while (next >= 0 && selected.includes(options[next]!.value)) next--;
        return next >= 0 ? next : i;
      });
    } else if (e.key === "Enter") {
      if (activeIdx >= 0 && activeIdx < options.length) {
        const o = options[activeIdx]!;
        if (!selected.includes(o.value)) onPick(o.value);
      }
    }
  }

  return (
    <div className={styles.picker} id={id} onKeyDown={onKeyDown}>
      {searchable && (
        <input
          type="text"
          autoFocus
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="type to filter…"
          className={styles.search}
        />
      )}
      <ul role="listbox" className={styles.list}>
        {options.map((o, idx) => {
          const isSelected = selected.includes(o.value);
          const isActive = idx === activeIdx;
          return (
            <li
              key={o.value}
              role="option"
              aria-selected={isSelected}
              aria-disabled={isSelected}
              className={`${styles.row} ${isSelected ? styles.rowDisabled : ""} ${isActive ? styles.rowActive : ""}`}
              onClick={() => { if (!isSelected) onPick(o.value); }}
              onMouseEnter={() => setActiveIdx(idx)}
            >
              <span>{o.label}</span>
              <span className={styles.rowCount}>{o.count.toLocaleString()}</span>
              {isSelected && <span className={styles.addedBadge}>added</span>}
            </li>
          );
        })}
        {options.length === 0 && <li className={styles.empty}>no matches</li>}
      </ul>
    </div>
  );
}
