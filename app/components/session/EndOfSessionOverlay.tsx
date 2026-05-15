"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  visible: boolean;
  count: number;
  onNewSession: () => void;
}

const AUTO_REDIRECT_MS = 15_000;

export function EndOfSessionOverlay({ visible, count, onNewSession }: Props) {
  const router = useRouter();
  const titleId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  // Once the user has interacted (focus or click within the overlay), we
  // suspend the 15s auto-redirect — they're clearly making a choice and a
  // surprise navigation would disorient screen-reader users mid-announcement.
  const [interacted, setInteracted] = useState(false);

  useEffect(() => {
    if (!visible) return;
    primaryRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (!visible || interacted) return;
    const t = setTimeout(() => router.push("/"), AUTO_REDIRECT_MS);
    return () => clearTimeout(t);
  }, [visible, interacted, router]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="end-of-session-overlay"
      onFocus={() => setInteracted(true)}
      onPointerDown={() => setInteracted(true)}
    >
      <h2 id={titleId}>session complete</h2>
      <p className="end-of-session-overlay-count">{count} images drawn</p>
      <div className="end-of-session-overlay-actions">
        <button
          type="button"
          className="end-of-session-overlay-btn"
          onClick={() => router.push("/")}
        >
          back to home
        </button>
        <button
          ref={primaryRef}
          type="button"
          className="end-of-session-overlay-btn end-of-session-overlay-btn-primary"
          onClick={onNewSession}
        >
          start new session
        </button>
      </div>
      <p aria-live="polite" className="end-of-session-overlay-hint">
        {interacted ? "auto-redirect paused" : "auto-redirecting in 15s"}
      </p>
    </div>
  );
}
