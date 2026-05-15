"use client";
import { useState } from "react";
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
        <div className="session-timer-dropdown">
          {OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={`u-icon-btn session-timer-dropdown-option${current === s ? " is-active" : ""}`}
              onClick={() => {
                onChange(s);
                setOpen(false);
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
