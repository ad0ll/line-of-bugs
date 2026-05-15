'use client';

import type { KeyboardEvent } from 'react';
import { Chip } from '@/app/components/ui/Chip';

export type SubjectValue = 'both' | 'nature' | 'specimen';
export type SubjectCounts = { nature: number; specimen: number; both: number };

const ORDER: SubjectValue[] = ['both', 'nature', 'specimen'];
const LABELS: Record<SubjectValue, string> = {
  both: 'all',
  nature: 'nature',
  specimen: 'specimen',
};

export interface SubjectTypeChipsProps {
  value: SubjectValue;
  counts: SubjectCounts;
  onChange: (v: SubjectValue) => void;
}

export function SubjectTypeChips({ value, counts, onChange }: SubjectTypeChipsProps) {
  function onKey(e: KeyboardEvent, v: SubjectValue) {
    const idx = ORDER.indexOf(v);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(ORDER[(idx + 1) % ORDER.length]!);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(ORDER[(idx - 1 + ORDER.length) % ORDER.length]!);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(v);
    }
  }

  return (
    <div className="subject-type-chips" role="group" aria-label="subject filter">
      {ORDER.map((v) => (
        <Chip
          key={v}
          label={LABELS[v]}
          count={counts[v]}
          active={value === v}
          tooltip={null}
          onClick={() => onChange(v)}
          onKeyDown={(e) => onKey(e, v)}
        />
      ))}
    </div>
  );
}
