'use client';

/**
 * Shared chip primitive used by every multi-select / single-select
 * chip wall (taxonomy, subject-type, report categories, ...).
 *
 * The `tooltip` prop is REQUIRED — pass `null` to opt out explicitly.
 * Surfacing the tooltip slot at the type level makes "did you think
 * about whether this chip is ambiguous?" a forced decision at every
 * callsite, instead of something a future contributor might miss.
 *
 * When a tooltip is provided, the chip is wrapped in <Tooltip> so the
 * explanation surfaces on keyboard focus too — not just desktop hover.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Tooltip } from '@/app/components/ui/Tooltip';

export interface ChipProps {
  label: ReactNode;
  /** Optional count badge. When `total` is also set and != count,
   *  renders "count / total"; collapse to a single number otherwise. */
  count?: number;
  total?: number;
  active: boolean;
  /** Zero-count grey-out state — chip stays clickable so the user
   *  can still toggle it (e.g. as a way to clear conflicting filters). */
  disabled?: boolean;
  /** Required: tooltip content OR `null` to opt out. Forces every
   *  callsite to explicitly consider tooltip coverage. */
  tooltip: ReactNode | null;
  onClick: () => void;
  /** Extra class for chip variants (e.g. "taxon-group-chip"). */
  className?: string;
  /** Inline style passthrough — used by chip walls for `--i` staggered
   *  fade-in animation. */
  style?: CSSProperties;
  /** ARIA. Defaults: aria-pressed = active. Override for radio-group
   *  semantics (role="radio" → aria-checked, not aria-pressed). */
  role?: string;
  ariaPressed?: boolean;
  ariaChecked?: boolean;
  ariaLabel?: string;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export function Chip({
  label,
  count,
  total,
  active,
  disabled = false,
  tooltip,
  onClick,
  className = '',
  style,
  role,
  ariaPressed,
  ariaChecked,
  ariaLabel,
  tabIndex,
  onKeyDown,
}: ChipProps) {
  const classes = [
    'chip',
    active ? 'chip-active' : '',
    disabled ? 'chip-disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const showSeparated = typeof count === 'number' && typeof total === 'number' && count !== total;

  const button = (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      style={style}
      role={role}
      aria-pressed={ariaPressed ?? (role ? undefined : active)}
      aria-checked={ariaChecked}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
    >
      <span className="chip-label">{label}</span>
      {typeof count === 'number' && (
        <span className="chip-count">
          {count.toLocaleString()}
          {showSeparated && (
            <span className="chip-count-total"> / {total!.toLocaleString()}</span>
          )}
        </span>
      )}
    </button>
  );

  return tooltip !== null ? (
    <Tooltip content={tooltip} showIcon={false}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}
