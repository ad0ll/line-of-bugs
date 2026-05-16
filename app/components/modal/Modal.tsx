"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /**
   * Visible-text label fallback. Prefer {@link ariaLabelledBy} so SR users
   * hear the heading element verbatim (and so the label tracks any future
   * heading-text change). Only set this when the modal genuinely has no
   * heading.
   */
  ariaLabel?: string;
  /**
   * id of the visible heading inside the modal. The dialog gets
   * aria-labelledby pointing at it, satisfying APG dialog requirements
   * (https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
   */
  ariaLabelledBy?: string;
}

/**
 * Native <dialog> wrapper — uses the browser's built-in focus trap,
 * Escape-to-close, and top-layer rendering. We still lock body scroll
 * (showModal() doesn't do that) and surface backdrop-click-to-close
 * (clicks on dialog::backdrop bubble to the dialog and its e.target IS
 * the dialog when no inner content is hit).
 */
export function Modal({ onClose, children, ariaLabel, ariaLabelledBy }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // onClose is recreated every render by callers (e.g., `() => router.back()`);
  // we route through a ref so the open/close effect can be mount-only and
  // never tear the dialog down on parent re-renders.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Tracks whether the close was triggered by user action vs. unmount cleanup,
  // so we don't fire onClose twice (once on user action, once on cleanup).
  const closingRef = useRef(false);
  // Where to send focus when the dialog closes. Captured BEFORE showModal()
  // so the browser's "previously focused element" matches what the user
  // expects (the trigger button, not the dialog itself).
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (!d.open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      d.showModal();
    }
    const onNativeClose = () => {
      if (closingRef.current) return;
      closingRef.current = true;
      onCloseRef.current();
      // Move focus back to the trigger AFTER the close handler runs so any
      // router.back()-induced re-render has settled. We defer to the next
      // task to give React time to reconcile.
      const target = restoreFocusRef.current;
      if (target && typeof target.focus === "function") {
        queueMicrotask(() => {
          // Only focus if the element is still in the document — the
          // trigger may have unmounted while the modal was open.
          if (target.isConnected) target.focus();
        });
      }
    };
    d.addEventListener("close", onNativeClose);
    // Cleanup only detaches the listener — calling d.close() here would queue
    // a 'close' event that, under React StrictMode's mount→unmount→mount cycle
    // in dev, lands on the NEW mount's listener and erroneously fires onClose.
    // The element is removed from the DOM on real unmount anyway.
    return () => {
      d.removeEventListener("close", onNativeClose);
    };
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Defence in depth around the native <dialog> Escape behaviour.
  // Native dialog close-on-Escape works in modern browsers, but: (a) it
  // requires the event to be 'trusted' (so synthetic dispatchEvent tests
  // can't drive it), and (b) WebKit/Firefox have known edge cases where
  // it doesn't fire (e.g., before initial focus has been placed inside
  // the dialog). Listening at window lets `d.close()` run from any
  // Escape press — and `d.close()` is idempotent if the browser already
  // closed it via the native path.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const d = dialogRef.current;
      if (!d || !d.open) return;
      d.close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function triggerClose() {
    const d = dialogRef.current;
    if (!d) return;
    if (d.open) d.close(); // 'close' event fires → onNativeClose → onClose()
    else onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className="modal-dialog"
      onClick={(e) => {
        // Clicks on dialog::backdrop bubble here with e.target === dialog
        if (e.target === dialogRef.current) triggerClose();
      }}
    >
      <div
        className="modal-dialog-inner"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          aria-label="close dialog"
          onClick={triggerClose}
        >
          ×
        </button>
        {children}
      </div>
    </dialog>
  );
}
