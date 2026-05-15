"use client";
import { useId, useState } from "react";

const PRESETS = [
  { label: "30s", seconds: 30 },
  { label: "60s", seconds: 60 },
  { label: "2m", seconds: 120 },
  { label: "3m", seconds: 180 },
  { label: "5m", seconds: 300 },
  { label: "10m", seconds: 600 },
];

interface Props {
  value: number;
  onChange: (seconds: number) => void;
}

export function IntervalPicker({ value, onChange }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const inputId = useId();
  const isPreset = PRESETS.some((p) => p.seconds === value);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {PRESETS.map((p) => (
          <button
            key={p.seconds}
            type="button"
            onClick={() => onChange(p.seconds)}
            className={`home-pill${value === p.seconds ? " is-active" : ""}`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          className={`home-pill${!isPreset || customOpen ? " is-active" : ""}`}
          aria-expanded={customOpen}
          aria-controls={inputId}
        >
          custom…
        </button>
      </div>
      {customOpen ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label htmlFor={inputId} className="home-radio-hint">
            seconds (10–3600)
          </label>
          <input
            id={inputId}
            type="number"
            min={10}
            max={3600}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="home-custom-seconds"
          />
        </div>
      ) : null}
    </div>
  );
}
