"use client";
import { useId } from "react";
import type { RepeatMode } from "@/lib/repeat-mode";

const OPTIONS: { value: RepeatMode; label: string; hint: string }[] = [
  { value: "default", label: "show everything", hint: "every photo, repeats included" },
  { value: "never-repeat-animals", label: "one per species", hint: "never see the same species twice" },
  { value: "allow-different-angles", label: "same species, different angles", hint: "multi-angle specimen sets" },
];

interface Props {
  value: RepeatMode;
  onChange: (v: RepeatMode) => void;
}

export function RepeatModeToggle({ value, onChange }: Props) {
  const baseId = useId();
  return (
    <div className="home-radio-list" role="radiogroup" aria-label="repeat behavior">
      {OPTIONS.map((opt) => {
        const optId = `${baseId}-${opt.value}`;
        return (
          <label
            key={opt.value}
            htmlFor={optId}
            className={`home-radio-card${value === opt.value ? " is-selected" : ""}`}
          >
            <input
              id={optId}
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
        );
      })}
    </div>
  );
}
