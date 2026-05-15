'use client';

import { useEffect, useRef, useState } from 'react';

export interface InstitutionPickerProps {
  institutions: { name: string; count: number }[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export function InstitutionPicker({ institutions, selected, onChange }: InstitutionPickerProps) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
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
        type="button"
        className={`chip ${selected.length > 0 ? 'chip-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div className="institution-popover" role="dialog" aria-label="institution selector">
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
                  <span className="institution-count">{i.count}</span>
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
