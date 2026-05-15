'use client';

import { useEffect, useId, useRef, useState } from 'react';

export interface InstitutionPickerProps {
  institutions: { name: string; count: number }[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export function InstitutionPicker({ institutions, selected, onChange }: InstitutionPickerProps) {
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
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
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

  const label = selected.length > 0 ? `${selected.length} selected` : 'institution: all';

  function toggle(name: string) {
    const set = new Set(selected);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    onChange([...set]);
  }

  return (
    <div className="institution-picker" ref={popRef}>
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
        <div id={panelId} className="institution-popover">
          <ul className="institution-list">
            {institutions.map((i) => (
              <li key={i.name}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(i.name)}
                    onChange={() => toggle(i.name)}
                  />
                  <span>{i.name}</span>
                  <span className="institution-count">{i.count.toLocaleString()}</span>
                </label>
              </li>
            ))}
          </ul>
          {selected.length > 0 && (
            <button type="button" className="institution-clear" onClick={() => onChange([])}>
              clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
