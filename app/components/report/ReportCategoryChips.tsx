"use client";

import type { ReportCategory } from "@/actions/submitReport";

const CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: "low-resolution", label: "low-resolution" },
  { value: "spooky", label: "spooky" },
  { value: "cropped", label: "cropped" },
  { value: "ai-generated", label: "ai-generated" },
  { value: "other", label: "other" },
];

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
