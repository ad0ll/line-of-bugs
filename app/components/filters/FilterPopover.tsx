'use client';

/**
 * Reusable multi-select popover used by the view / life_stage / sex
 * filters in the gallery + home pages. Behavior mirrors the existing
 * InstitutionPicker (close on Escape, close on outside-click, checkbox
 * list with counts) but renders `unknown` first when present so it's
 * obvious to users that filtering would shrink the pool.
 */
import { useEffect, useRef, useState } from 'react';

export interface FilterOption {
  name: string;
  count: number;
}

export interface FilterPopoverProps {
  /** Trigger button label when nothing is selected (e.g., "view: all"). */
  idleLabel: string;
  /** Trigger button label when something IS selected (gets count appended). */
  selectedLabel?: (count: number) => string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Accessible label for the open popover container. */
  ariaLabel?: string;
}

export function FilterPopover({
  idleLabel,
  selectedLabel,
  options,
  selected,
  onChange,
  ariaLabel,
}: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      window.addEventListener('keydown', onKey);
      window.addEventListener('mousedown', onClick);
      return () => {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('mousedown', onClick);
      };
    }
  }, [open]);

  const label =
    selected.length > 0
      ? (selectedLabel ? selectedLabel(selected.length) : `${selected.length} selected`)
      : idleLabel;

  function toggle(name: string) {
    const set = new Set(selected);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    onChange([...set]);
  }

  return (
    <div className="filter-popover" ref={popRef}>
      <button
        type="button"
        className={`chip ${selected.length > 0 ? 'chip-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div className="filter-popover-panel" role="dialog" aria-label={ariaLabel ?? idleLabel}>
          <ul className="filter-popover-list">
            {options.map((o) => (
              <li key={o.name}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(o.name)}
                    onChange={() => toggle(o.name)}
                  />
                  <span className="filter-popover-name">{o.name}</span>
                  <span className="filter-popover-count">{o.count}</span>
                </label>
              </li>
            ))}
          </ul>
          {selected.length > 0 && (
            <button
              type="button"
              className="filter-popover-clear"
              onClick={() => onChange([])}
            >
              clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
