"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
}

/**
 * Native <dialog> wrapper — uses the browser's built-in focus trap,
 * Escape-to-close, and top-layer rendering. We still lock body scroll
 * (showModal() doesn't do that) and surface backdrop-click-to-close
 * (clicks on dialog::backdrop bubble to the dialog and its e.target IS
 * the dialog when no inner content is hit).
 */
export function Modal({ onClose, children, ariaLabel }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // onClose is recreated every render by callers (e.g., `() => router.back()`);
  // we route through a ref so the open/close effect can be mount-only and
  // never tear the dialog down on parent re-renders.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Tracks whether the close was triggered by user action vs. unmount cleanup,
  // so we don't fire onClose twice (once on user action, once on cleanup).
  const closingRef = useRef(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (!d.open) d.showModal();
    const onNativeClose = () => {
      if (closingRef.current) return;
      closingRef.current = true;
      onCloseRef.current();
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

  function triggerClose() {
    const d = dialogRef.current;
    if (!d) return;
    if (d.open) d.close(); // 'close' event fires → onNativeClose → onClose()
    else onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={ariaLabel}
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
