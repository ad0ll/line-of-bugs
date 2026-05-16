'use client';

/**
 * Compact accessible tooltip used to explain filter labels that depend
 * on biology jargon (life stage, sex, view label, subject state, etc.).
 *
 * Shows on hover OR keyboard focus, positions above the trigger by
 * default, hides on Escape. Pure CSS for the visuals — React just
 * manages the open/closed state so it's keyboard-friendly.
 *
 * Usage — pass a SINGLE focusable child (button, link, or [tabindex]).
 * The tooltip clones the child to attach aria-describedby when open,
 * so screen readers announce the tooltip text as a description of the
 * trigger (not as floating content).
 *
 *   <Tooltip content="Adult, larva, pupa…">
 *     <span tabIndex={0}>life stage</span>
 *   </Tooltip>
 */
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useState,
  useRef,
  useEffect,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** When true, render a small `(?)` affordance next to the children so users
   *  know there's help available without having to hover-hunt. Defaults true. */
  showIcon?: boolean;
}

interface ChildWithAria {
  'aria-describedby'?: string;
}

export function Tooltip({ content, children, showIcon = true }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Once a descendant has been clicked (e.g. opening a filter popover),
  // suppress the hover-tooltip until the pointer/focus leaves the wrap.
  // Prevents the tooltip-bubble and popover-panel from stacking below
  // the same trigger.
  const [suppressed, setSuppressed] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function onEnter() { if (!suppressed) setOpen(true); }
  function onLeaveContainer(e: React.FocusEvent | React.MouseEvent) {
    // Don't close when focus/pointer crosses to a descendant of the wrap —
    // the bubble itself is now selectable (pointer-events: auto), and users
    // may need to mouse over it to read long tooltip text.
    const related = (e as React.FocusEvent).relatedTarget as Node | null;
    if (related && wrapRef.current?.contains(related)) return;
    setOpen(false);
    setSuppressed(false);
  }
  function onClickWithin(e: React.MouseEvent) {
    // Don't suppress when the click is on our own ⓘ icon — that button
    // explicitly toggles the tooltip and handles its own preventDefault.
    if ((e.target as HTMLElement).closest('.tooltip-icon')) return;
    setOpen(false);
    setSuppressed(true);
  }

  // Attach aria-describedby to the single child so SR users hear the tooltip
  // text as a description of the trigger element. Callers MUST pass exactly
  // one element that can take aria-* (a span, button, link, etc.). Non-element
  // children (strings, fragments) get wrapped in a span as a fallback so
  // a11y still works at runtime.
  const onlyChild = Children.only(children);
  let renderedChild: ReactNode;
  if (isValidElement(onlyChild)) {
    const typed = onlyChild as ReactElement<ChildWithAria>;
    renderedChild = cloneElement(typed, {
      'aria-describedby': open ? id : undefined,
    });
  } else {
    renderedChild = (
      <span aria-describedby={open ? id : undefined}>{onlyChild}</span>
    );
  }

  return (
    <span
      ref={wrapRef}
      className="tooltip-wrap"
      onMouseEnter={onEnter}
      onMouseLeave={onLeaveContainer}
      onFocus={onEnter}
      onBlur={onLeaveContainer}
      onClick={onClickWithin}
    >
      {renderedChild}
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
