"use client";

import type { SubjectType } from "@/lib/subject";

const OPTIONS: { value: SubjectType; label: string }[] = [
  { value: "wild", label: "wild" },
  { value: "captive", label: "captive" },
  { value: "specimen", label: "specimen" },
  { value: "all", label: "all" },
];

/** @deprecated kept as a transitional alias — use SubjectType directly. */
export type SubjectChoice = SubjectType;

interface Props {
  value: SubjectType;
  onChange: (v: SubjectType) => void;
}

export function SubjectFilter({ value, onChange }: Props) {
  function onKey(e: React.KeyboardEvent, current: SubjectType) {
    const idx = OPTIONS.findIndex((o) => o.value === current);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(OPTIONS[(idx + 1) % OPTIONS.length]!.value);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(OPTIONS[(idx - 1 + OPTIONS.length) % OPTIONS.length]!.value);
    }
  }

  return (
    <div className="subject-filter" role="radiogroup" aria-label="subject type">
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKey(e, opt.value)}
            className={`home-pill${active ? " is-active" : ""}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
