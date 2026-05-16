"use client";

import { useEffect, useState } from "react";

export type ToastSeverity = "success" | "error";
export interface ToastItem {
  id: string;
  message: string;
  severity: ToastSeverity;
}

let toastQueue: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

// Stable id source. crypto.randomUUID() is available in all modern browsers
// and in Node 19+. Falls back to a counter+timestamp when crypto isn't on
// the global (older test environments, SSR before hydration). We keep the
// fallback monotonic so React's key invariant (unique per parent) holds.
let _toastCounter = 0;
function nextToastId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  _toastCounter += 1;
  return `toast-${Date.now()}-${_toastCounter}`;
}

export function showToast(message: string, severity: ToastSeverity = "success"): void {
  const item: ToastItem = { id: nextToastId(), message, severity };
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
        {successItems.map((t) => (
          <div key={t.id} className="toast">{t.message}</div>
        ))}
      </div>
      <div role="alert" aria-live="assertive">
        {errorItems.map((t) => (
          <div key={t.id} className="toast toast--error">{t.message}</div>
        ))}
      </div>
    </div>
  );
}
