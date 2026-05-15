'use client';

/**
 * Reusable multi-select popover used by the view / life_stage / sex
 * filters in the gallery + home pages. Behavior mirrors the existing
 * InstitutionPicker (close on Escape, close on outside-click, checkbox
 * list with counts) but renders `unknown` first when present so it's
 * obvious to users that filtering would shrink the pool.
 */
import { useEffect, useId, useRef, useState } from 'react';

export interface FilterOption {
  name: string;
  /** Filtered count — how many rows would match given other-axis filters. */
  count: number;
  /** Absolute unfiltered count. When present and != count, the option
   *  renders "filtered / total"; otherwise just one number. */
  total?: number;
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
}: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
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
        ref={triggerRef}
        type="button"
        className={`chip ${selected.length > 0 ? 'chip-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
      >
        {label}
      </button>
      {open && (
        <div id={panelId} className="filter-popover-panel">
          <ul className="filter-popover-list">
            {[...options]
              .sort((a, b) => {
                // Non-zero filtered options first (most useful at top);
                // ties break on alphabetical name.
                const an = a.count === 0 ? 1 : 0;
                const bn = b.count === 0 ? 1 : 0;
                if (an !== bn) return an - bn;
                if (a.count !== b.count) return b.count - a.count;
                return a.name.localeCompare(b.name);
              })
              .map((o) => {
              const total = o.total ?? o.count;
              if (total === 0) return null;
              const showSplit = typeof o.total === "number" && o.count !== o.total;
              const disabled = o.count === 0;
              return (
                <li key={o.name} className={disabled ? "filter-popover-row-disabled" : ""}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(o.name)}
                      onChange={() => toggle(o.name)}
                    />
                    <span className="filter-popover-name">{o.name}</span>
                    <span className="filter-popover-count">
                      {o.count.toLocaleString()}
                      {showSplit && (
                        <span className="filter-popover-count-total"> / {total.toLocaleString()}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
              })}
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
