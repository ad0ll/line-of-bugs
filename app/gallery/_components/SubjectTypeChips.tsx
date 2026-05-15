'use client';

import type { KeyboardEvent } from 'react';
import { Chip } from '@/app/components/ui/Chip';
import type { SubjectType } from '@/lib/subject';

/** @deprecated kept as a transitional alias — use SubjectType directly. */
export type SubjectValue = SubjectType;

export type SubjectCounts = {
  wild: number;
  captive: number;
  specimen: number;
  all: number;
};

const ORDER: SubjectType[] = ['wild', 'captive', 'specimen', 'all'];
const LABELS: Record<SubjectType, string> = {
  wild: 'wild',
  captive: 'captive',
  specimen: 'specimen',
  all: 'all',
};

export interface SubjectTypeChipsProps {
  value: SubjectType;
  /** Filtered counts (other-axis applied, subject ignored). */
  filtered: SubjectCounts;
  /** Absolute unfiltered counts — the "total" half of "filtered/total". */
  totals: SubjectCounts;
  onChange: (v: SubjectType) => void;
}

export function SubjectTypeChips({
  value,
  filtered,
  totals,
  onChange,
}: SubjectTypeChipsProps) {
  function onKey(e: KeyboardEvent, v: SubjectType) {
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
          count={filtered[v]}
          total={totals[v]}
          active={value === v}
          disabled={filtered[v] === 0}
          tooltip={null}
          onClick={() => onChange(v)}
          onKeyDown={(e) => onKey(e, v)}
        />
      ))}
    </div>
  );
}
