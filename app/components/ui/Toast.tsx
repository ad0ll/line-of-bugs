"use client";

import { useEffect, useState } from "react";

export type ToastSeverity = "success" | "error";
export interface ToastItem {
  message: string;
  severity: ToastSeverity;
}

let toastQueue: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

export function showToast(message: string, severity: ToastSeverity = "success"): void {
  const item: ToastItem = { message, severity };
  toastQueue = [...toastQueue, item];
  listeners.forEach((l) => l(toastQueue));
  setTimeout(() => {
    toastQueue = toastQueue.filter((t) => t !== item);
    listeners.forEach((l) => l(toastQueue));
  }, 3500);
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);
  const successItems = items.filter((t) => t.severity === "success");
  const errorItems = items.filter((t) => t.severity === "error");
  return (
    <div className="toast-host">
      <div role="status" aria-live="polite">
        {successItems.map((t, i) => (
          <div key={`s-${t.message}-${i}`} className="toast">{t.message}</div>
        ))}
      </div>
      <div role="alert" aria-live="assertive">
        {errorItems.map((t, i) => (
          <div key={`e-${t.message}-${i}`} className="toast toast--error">{t.message}</div>
        ))}
      </div>
    </div>
  );
}
