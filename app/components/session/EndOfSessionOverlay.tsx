"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/tokens";

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
      onFocus={() => setInteracted(true)}
      onPointerDown={() => setInteracted(true)}
      style={{
        position: "fixed",
        inset: 0,
        background: T.surfaceBackdrop,
        backdropFilter: T.blurMd,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: T.s10,
        zIndex: 50,
        animation: "fade-in 0.3s ease forwards",
      }}
    >
      <h2
        id={titleId}
        style={{
          fontFamily: "var(--font-display), serif",
          fontWeight: 500,
          fontSize: 36,
          margin: 0,
        }}
      >
        session complete
      </h2>
      <p style={{ color: T.textSecondary, fontSize: T.textLg, margin: 0 }}>
        {count} images drawn
      </p>
      <div style={{ display: "flex", gap: T.s6 }}>
        <button
          type="button"
          onClick={() => router.push("/")}
          style={{
            background: T.surface1,
            color: T.textPrimary,
            border: `1px solid ${T.borderMedium}`,
            borderRadius: T.r2xl,
            padding: `${T.s4}px ${T.s10}px`,
            fontSize: T.textBase,
            cursor: "pointer",
          }}
        >
          back to home
        </button>
        <button
          ref={primaryRef}
          type="button"
          onClick={onNewSession}
          style={{
            background: T.surface2,
            color: T.textPrimary,
            border: `1px solid ${T.borderEmphasis}`,
            borderRadius: T.r2xl,
            padding: `${T.s4}px ${T.s10}px`,
            fontSize: T.textBase,
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          start new session
        </button>
      </div>
      <p
        aria-live="polite"
        style={{ color: T.textTertiary, fontSize: T.textXs, margin: 0 }}
      >
        {interacted ? "auto-redirect paused" : "auto-redirecting in 15s"}
      </p>
    </div>
  );
}
