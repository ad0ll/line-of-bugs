"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/tokens";

interface Props {
  visible: boolean;
  count: number;
  onNewSession: () => void;
}

export function EndOfSessionOverlay({ visible, count, onNewSession }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => router.push("/"), 15_000);
    return () => clearTimeout(t);
  }, [visible, router]);

  if (!visible) return null;

  return (
    <div
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
      <style>{`@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }`}</style>
      <h2 style={{ fontFamily: "var(--font-display), serif", fontWeight: 500, fontSize: 36, margin: 0 }}>
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
      <p style={{ color: T.textTertiary, fontSize: T.textXs, margin: 0 }}>
        auto-redirecting in 15s
      </p>
    </div>
  );
}
