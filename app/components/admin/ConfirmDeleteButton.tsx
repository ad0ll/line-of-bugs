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

  if (stage === "loading") {
    return <button type="button" className="btn-destructive" disabled>deleting…</button>;
  }
  if (stage === "armed") {
    return (
      <button type="button" className="btn-destructive btn-armed" onClick={onClick}>
        are you sure?
      </button>
    );
  }
  return (
    <button type="button" className="btn-destructive-idle" onClick={onClick}>
      delete
    </button>
  );
}
