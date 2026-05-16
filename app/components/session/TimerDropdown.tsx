"use client";
import { useEffect, useId, useRef, useState } from "react";
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
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [activeIdx, setActiveIdx] = useState<number>(() => {
    const i = OPTIONS.indexOf(current);
    return i >= 0 ? i : 0;
  });

  // Keep activeIdx in sync with external `current` so opening the dropdown
  // always highlights the currently selected interval even when the parent
  // changes it via another control (e.g. keyboard shortcut).
  useEffect(() => {
    const i = OPTIONS.indexOf(current);
    if (i >= 0) setActiveIdx(i);
  }, [current]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    const btn = triggerRef.current?.querySelector<HTMLButtonElement>("button");
    btn?.focus();
  };

  // On open, focus the selected (or first) option.
  useEffect(() => {
    if (!open) return;
    const i = OPTIONS.indexOf(current);
    const target = i >= 0 ? i : 0;
    setActiveIdx(target);
    optionRefs.current[target]?.focus();
  }, [open, current]);

  // Outside pointerdown closes the dropdown — pointerdown covers both touch
  // and mouse on the same event so taps on tablets dismiss properly.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = (activeIdx + 1) % OPTIONS.length;
      setActiveIdx(next);
      optionRefs.current[next]?.focus();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = (activeIdx - 1 + OPTIONS.length) % OPTIONS.length;
      setActiveIdx(next);
      optionRefs.current[next]?.focus();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onChange(OPTIONS[activeIdx]!);
      closeAndRestoreFocus();
    }
  };

  return (
    <div style={{ position: "relative" }} ref={rootRef}>
      <div ref={triggerRef} aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId}>
        <IconBtn label="timer" hint={label(current)} active={open} onClick={() => setOpen((o) => !o)}>
          ⏱
        </IconBtn>
      </div>
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="frame duration"
          className="session-timer-dropdown"
          onKeyDown={onKeyDown}
        >
          {OPTIONS.map((s, i) => (
            <div
              key={s}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              role="option"
              tabIndex={0}
              aria-selected={current === s}
              className={`u-icon-btn session-timer-dropdown-option${current === s ? " is-active" : ""}`}
              onClick={() => {
                onChange(s);
                closeAndRestoreFocus();
              }}
              onFocus={() => setActiveIdx(i)}
            >
              {label(s)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
