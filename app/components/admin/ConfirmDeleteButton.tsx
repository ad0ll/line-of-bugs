"use client";

import { useEffect, useRef, useState } from "react";

export interface ConfirmDeleteButtonProps {
  onConfirm: () => Promise<void>;
}

export function ConfirmDeleteButton({ onConfirm }: ConfirmDeleteButtonProps) {
  const [stage, setStage] = useState<"idle" | "armed" | "loading">("idle");
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (stage === "armed") {
      armTimerRef.current = setTimeout(() => setStage("idle"), 3000);
    }
    return () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    };
  }, [stage]);

  async function onClick() {
    if (stage === "idle") {
      setStage("armed");
      return;
    }
    if (stage === "armed") {
      setStage("loading");
      try {
        await onConfirm();
      } finally {
        setStage("idle");
      }
    }
  }

  const announcement =
    stage === "armed"
      ? "confirm delete — click again to delete permanently"
      : stage === "loading"
        ? "deleting"
        : "";

  return (
    <>
      {stage === "loading" ? (
        <button
          type="button"
          className="btn-destructive"
          disabled
          aria-label="deleting"
        >
          deleting…
        </button>
      ) : stage === "armed" ? (
        <button
          type="button"
          className="btn-destructive btn-armed"
          onClick={onClick}
          aria-label="confirm delete — click again to delete permanently"
        >
          are you sure?
        </button>
      ) : (
        <button
          type="button"
          className="btn-destructive-idle"
          onClick={onClick}
          aria-label="delete"
        >
          delete
        </button>
      )}
      <span role="status" aria-live="polite" className="u-sr-only">
        {announcement}
      </span>
    </>
  );
}
