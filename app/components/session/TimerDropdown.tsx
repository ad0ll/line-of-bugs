"use client";
import { useState } from "react";
import { T } from "@/lib/tokens";
import { IconBtn } from "@/app/components/ui/IconBtn";

const OPTIONS = [30, 60, 120, 180, 300, 600];

interface Props {
  current: number; // seconds
  onChange: (s: number) => void;
}

function label(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)}m`;
}

export function TimerDropdown({ current, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <IconBtn label="timer" hint={label(current)} active={open} onClick={() => setOpen((o) => !o)}>
        ⏱
      </IconBtn>
      {open ? (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: T.surfacePanel,
            border: `1px solid ${T.borderMedium}`,
            borderRadius: T.r2xl,
            padding: T.s2,
            display: "flex",
            flexDirection: "column",
            minWidth: 80,
            boxShadow: T.shadowPanel,
          }}
        >
          {OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={`u-icon-btn${current === s ? " is-active" : ""}`}
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              style={{
                padding: `${T.s3}px ${T.s5}px`,
                fontFamily: "var(--font-mono), monospace",
                fontSize: T.textSm,
                textAlign: "left",
              }}
            >
              {label(s)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
