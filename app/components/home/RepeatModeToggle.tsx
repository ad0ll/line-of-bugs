"use client";
import { useId } from "react";
import type { RepeatMode } from "@/lib/repeat-mode";

// Order: high variety → low variety. (high) is the default — most users
// want unique-species sessions; (low) "everything" is escape hatch.
const OPTIONS: { value: RepeatMode; label: string; level: "high" | "med" | "low" }[] = [
  { value: "never-repeat-animals", label: "never repeat the same species", level: "high" },
  { value: "allow-different-angles", label: "include same species from different angles", level: "med" },
  { value: "default", label: "include all photos of your chosen bugs", level: "low" },
];

const LEVEL_TEXT: Record<"high" | "med" | "low", string> = {
  high: "high",
  med: "medium",
  low: "low",
};

interface Props {
  value: RepeatMode;
  onChange: (v: RepeatMode) => void;
}

export function RepeatModeToggle({ value, onChange }: Props) {
  const baseId = useId();
  return (
    <div className="home-radio-list" role="radiogroup" aria-label="novelty">
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
            <span className="home-radio-card-text">
              <span className="home-radio-level">({LEVEL_TEXT[opt.level]})</span>{" "}
              <span className="home-radio-label">{opt.label}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
