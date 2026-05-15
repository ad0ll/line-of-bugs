"use client";

import { useEffect, useState } from "react";

let toastQueue: string[] = [];
const listeners = new Set<(messages: string[]) => void>();

export function showToast(msg: string): void {
  toastQueue = [...toastQueue, msg];
  listeners.forEach((l) => l(toastQueue));
  setTimeout(() => {
    toastQueue = toastQueue.filter((m) => m !== msg);
    listeners.forEach((l) => l(toastQueue));
  }, 3500);
}

export function ToastHost() {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    listeners.add(setMessages);
    return () => {
      listeners.delete(setMessages);
    };
  }, []);
  return (
    <div className="toast-host" aria-live="polite">
      {messages.map((m, i) => (
        <div key={`${m}-${i}`} className="toast">{m}</div>
      ))}
    </div>
  );
}
