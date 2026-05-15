"use client";

import { REPORT_CATEGORIES, REPORT_CATEGORY_LABELS, type ReportCategory } from "@/lib/report-categories";
import { Chip } from "@/app/components/ui/Chip";

const CATEGORIES: { value: ReportCategory; label: string }[] = REPORT_CATEGORIES.map((v) => ({
  value: v,
  label: REPORT_CATEGORY_LABELS[v],
}));

export interface ReportCategoryChipsProps {
  value: ReportCategory | null;
  onChange: (v: ReportCategory) => void;
  ariaLabelledBy?: string;
  required?: boolean;
}

export function ReportCategoryChips({ value, onChange, ariaLabelledBy, required }: ReportCategoryChipsProps) {
  return (
    <div
      className="report-category-chips"
      role="group"
      aria-label={ariaLabelledBy ? undefined : "report category"}
      aria-labelledby={ariaLabelledBy}
      aria-required={required ? true : undefined}
    >
      {CATEGORIES.map((c) => (
        <Chip
          key={c.value}
          label={c.label}
          active={value === c.value}
          tooltip={null}
          onClick={() => onChange(c.value)}
        />
      ))}
    </div>
  );
}
