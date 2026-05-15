"use client";
import { T } from "@/lib/tokens";

const OPTIONS = [
  { value: "nature", label: "nature" },
  { value: "specimen", label: "specimen" },
  { value: "both", label: "both" },
] as const;

export type SubjectChoice = (typeof OPTIONS)[number]["value"];

interface Props {
  value: SubjectChoice;
  onChange: (v: SubjectChoice) => void;
}

export function SubjectFilter({ value, onChange }: Props) {
  function onKey(e: React.KeyboardEvent, current: SubjectChoice) {
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
    <div style={{ display: "flex", gap: T.s3 }} role="radiogroup" aria-label="subject type">
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
            className={`u-icon-btn${active ? " is-active" : ""}`}
            style={{
              padding: `${T.s4}px ${T.s8}px`,
              borderRadius: T.r2xl,
              fontFamily: "var(--font-sans), system-ui, sans-serif",
              fontSize: T.textBase,
              fontWeight: 500,
              textTransform: "lowercase",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
