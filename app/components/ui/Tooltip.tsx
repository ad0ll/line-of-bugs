'use client';

/**
 * Compact accessible tooltip used to explain filter labels that depend
 * on biology jargon (life stage, sex, view label, subject state, etc.).
 *
 * Shows on hover OR keyboard focus, positions above the trigger by
 * default, hides on Escape. Pure CSS for the visuals — React just
 * manages the open/closed state so it's keyboard-friendly.
 *
 * Usage:
 *   <Tooltip content="Adult, larva, pupa…" >
 *     <span>life stage</span>
 *   </Tooltip>
 */
import { useId, useState, useRef, useEffect, type ReactNode } from 'react';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** When true, render a small `(?)` affordance next to the children so users
   *  know there's help available without having to hover-hunt. Defaults true. */
  showIcon?: boolean;
}

export function Tooltip({ content, children, showIcon = true }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className="tooltip-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {showIcon && (
        <button
          type="button"
          className="tooltip-icon"
          aria-label="more info"
          aria-expanded={open}
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault();
            setOpen((v) => !v);
          }}
        >
          ⓘ
        </button>
      )}
      {open && (
        <span id={id} role="tooltip" className="tooltip-bubble">
          {content}
        </span>
      )}
    </span>
  );
}
