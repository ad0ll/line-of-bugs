"use client";
import { useState } from "react";
import { T } from "@/lib/tokens";

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
  const isPreset = PRESETS.some((p) => p.seconds === value);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.s4 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: T.s3 }}>
        {PRESETS.map((p) => (
          <button
            key={p.seconds}
            type="button"
            onClick={() => onChange(p.seconds)}
            className={`u-icon-btn${value === p.seconds ? " is-active" : ""}`}
            style={{
              padding: `${T.s4}px ${T.s7}px`,
              borderRadius: T.r2xl,
              fontFamily: "var(--font-mono), monospace",
              fontSize: T.textMd,
              fontWeight: 500,
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          className={`u-icon-btn${!isPreset || customOpen ? " is-active" : ""}`}
          style={{
            padding: `${T.s4}px ${T.s7}px`,
            borderRadius: T.r2xl,
            fontFamily: "var(--font-mono), monospace",
            fontSize: T.textMd,
            fontWeight: 500,
          }}
        >
          custom…
        </button>
      </div>
      {customOpen ? (
        <input
          type="number"
          min={10}
          max={3600}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            background: T.surfaceInput,
            border: `1px solid ${T.borderMedium}`,
            borderRadius: T.r2xl,
            padding: `${T.s4}px ${T.s5}px`,
            color: T.textPrimary,
            fontFamily: "var(--font-mono), monospace",
            width: 120,
          }}
          aria-label="custom seconds"
        />
      ) : null}
    </div>
  );
}
