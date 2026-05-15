'use client';

/**
 * R6 disclosure widget — used to hide advanced filters behind a chevron
 * that the user has to expand. State is React-managed (not native
 * <details>) so the chevron + badge can be styled freely and the
 * height-collapse animation works.
 *
 * Animation strategy (see app/globals.css):
 *   - grid-template-rows: 0fr → 1fr transition (CSS-only auto-height)
 *   - chevron rotates 0 → 90deg
 *   - body content opacity fades in 100ms after layout starts moving
 * Respects prefers-reduced-motion globally.
 */
import { useId, useState, type ReactNode } from 'react';

export interface CollapsibleSectionProps {
  title: string;
  /** Default open state. */
  defaultOpen?: boolean;
  /** Small chip-style badge shown when the section is collapsed —
   *  useful for hinting "(3 selected)" so users notice hidden filters. */
  badge?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  defaultOpen = false,
  badge,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <section className="collapsible-section">
      <button
        type="button"
        className="collapsible-trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="collapsible-chevron" aria-hidden>
          ▸
        </span>
        <span className="collapsible-title">{title}</span>
        {badge !== undefined && badge !== null && (
          <span className="collapsible-badge">{badge}</span>
        )}
      </button>
      <div
        id={id}
        className="collapsible-body"
        data-open={open ? 'true' : 'false'}
        aria-hidden={!open}
      >
        <div className="collapsible-body-inner">{children}</div>
      </div>
    </section>
  );
}
