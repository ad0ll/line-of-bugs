"use client";

interface Props {
  visible: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function EdgePrevNext({ visible, canPrev, canNext, onPrev, onNext }: Props) {
  return (
    <>
      <button
        type="button"
        aria-label="previous image"
        className="session-edge-btn session-edge-btn-prev"
        onClick={onPrev}
        disabled={!canPrev}
        style={{
          opacity: visible && canPrev ? 1 : 0,
          pointerEvents: visible && canPrev ? "auto" : "none",
        }}
      >
        ◀
      </button>
      <button
        type="button"
        aria-label="next image"
        className="session-edge-btn session-edge-btn-next"
        onClick={onNext}
        disabled={!canNext}
        style={{
          opacity: visible && canNext ? 1 : 0,
          pointerEvents: visible && canNext ? "auto" : "none",
        }}
      >
        ▶
      </button>
    </>
  );
}
