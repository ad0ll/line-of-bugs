"use client";
import type { RepeatMode } from "@/lib/repeat-mode";

const OPTIONS: { value: RepeatMode; label: string; hint: string }[] = [
  { value: "default", label: "default", hint: "show everything" },
  { value: "never-repeat-animals", label: "never repeat animals", hint: "one image per species" },
  { value: "allow-different-angles", label: "allow same animal, different angles", hint: "multi-angle collections" },
];

interface Props {
  value: RepeatMode;
  onChange: (v: RepeatMode) => void;
}

export function RepeatModeToggle({ value, onChange }: Props) {
  return (
    <div className="home-radio-list" role="radiogroup" aria-label="repeat behavior">
      {OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className={`home-radio-card${value === opt.value ? " is-selected" : ""}`}
        >
          <input
            type="radio"
            name="repeat-mode"
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="home-radio-label">{opt.label}</span>
            <span className="home-radio-hint">{opt.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
