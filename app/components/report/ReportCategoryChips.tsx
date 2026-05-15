"use client";

import { REPORT_CATEGORIES, REPORT_CATEGORY_LABELS, type ReportCategory } from "@/lib/report-categories";

const CATEGORIES: { value: ReportCategory; label: string }[] = REPORT_CATEGORIES.map((v) => ({
  value: v,
  label: REPORT_CATEGORY_LABELS[v],
}));

export interface ReportCategoryChipsProps {
  value: ReportCategory | null;
  onChange: (v: ReportCategory) => void;
}

export function ReportCategoryChips({ value, onChange }: ReportCategoryChipsProps) {
  return (
    <div className="report-category-chips" role="group" aria-label="report category">
      {CATEGORIES.map((c) => (
        <button
          key={c.value}
          type="button"
          className={`chip ${value === c.value ? "chip-active" : ""}`}
          aria-pressed={value === c.value}
          onClick={() => onChange(c.value)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
