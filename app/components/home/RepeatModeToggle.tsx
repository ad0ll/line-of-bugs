"use client";
import { T } from "@/lib/tokens";
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
    <div style={{ display: "flex", flexDirection: "column", gap: T.s3 }} role="radiogroup" aria-label="repeat behavior">
      {OPTIONS.map((opt) => (
        <label
          key={opt.value}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: T.s4,
            cursor: "pointer",
            padding: T.s3,
            borderRadius: T.r2xl,
            background: value === opt.value ? T.surfaceActive : "transparent",
            transition: `background ${T.timingFast}`,
          }}
        >
          <input
            type="radio"
            name="repeat-mode"
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            style={{ marginTop: 4, accentColor: T.surface2 }}
          />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ color: T.textPrimary, fontWeight: 500 }}>{opt.label}</span>
            <span style={{ color: T.textTertiary, fontSize: T.textXs }}>{opt.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
