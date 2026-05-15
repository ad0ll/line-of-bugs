"use client";
import { T } from "@/lib/tokens";

interface Props {
  visible: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function EdgePrevNext({ visible, canPrev, canNext, onPrev, onNext }: Props) {
  const base: React.CSSProperties = {
    position: "fixed",
    top: 0,
    bottom: 0,
    width: 96,
    background: "transparent",
    border: "none",
    color: T.textSecondary,
    fontSize: 48,
    fontWeight: 300,
    cursor: "pointer",
    transition: `opacity ${T.timingSlow}`,
    zIndex: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  return (
    <>
      <button
        type="button"
        aria-label="previous image"
        onClick={onPrev}
        disabled={!canPrev}
        style={{
          ...base,
          left: 0,
          opacity: visible && canPrev ? 1 : 0,
          pointerEvents: visible && canPrev ? "auto" : "none",
        }}
      >
        ◀
      </button>
      <button
        type="button"
        aria-label="next image"
        onClick={onNext}
        disabled={!canNext}
        style={{
          ...base,
          right: 0,
          opacity: visible && canNext ? 1 : 0,
          pointerEvents: visible && canNext ? "auto" : "none",
        }}
      >
        ▶
      </button>
    </>
  );
}
