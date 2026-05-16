import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "vitest-browser-react";
import { useHighResTimer } from "@/lib/hooks/useHighResTimer";

describe("useHighResTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onTick with elapsed time when active", async () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    await renderHook(() => useHighResTimer(1000, true, onTick, onEnd, "k1"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onTick).toHaveBeenCalled();
    expect(onTick.mock.calls.at(-1)![0]).toBeGreaterThan(0);
  });

  it("calls onEnd when duration reached", async () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    await renderHook(() => useHighResTimer(50, true, onTick, onEnd, "k1"));
    await vi.advanceTimersByTimeAsync(200);
    expect(onEnd).toHaveBeenCalled();
  });

  it("does not call onTick when active is false", async () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    await renderHook(() => useHighResTimer(1000, false, onTick, onEnd, "k1"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onTick).not.toHaveBeenCalled();
  });

  it("pauses when document becomes hidden and resumes when visible", async () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    await renderHook(() => useHighResTimer(2000, true, onTick, onEnd, "k1"));
    await vi.advanceTimersByTimeAsync(120);
    const callsBeforeHide = onTick.mock.calls.length;
    expect(callsBeforeHide).toBeGreaterThan(0);

    // Simulate hide. In real chromium `document.hidden` is read-only by
    // the spec, but defineProperty still overrides it; the same shape works
    // as in happy-dom.
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(500);
    const callsAfterHide = onTick.mock.calls.length;
    expect(callsAfterHide - callsBeforeHide).toBeLessThanOrEqual(1);

    // Simulate re-show — timer should resume.
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(200);
    expect(onTick.mock.calls.length).toBeGreaterThan(callsAfterHide);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });

  it("picks up latest onTick callback without restarting the timer", async () => {
    const onTickA = vi.fn();
    const onTickB = vi.fn();
    const onEnd = vi.fn();
    const { rerender } = await renderHook(
      (props?: { tick: (elapsed: number) => void }) =>
        useHighResTimer(2000, true, props?.tick ?? onTickA, onEnd, "k1"),
      { initialProps: { tick: onTickA } },
    );
    await vi.advanceTimersByTimeAsync(80);
    expect(onTickA).toHaveBeenCalled();
    await rerender({ tick: onTickB });
    await vi.advanceTimersByTimeAsync(80);
    expect(onTickB).toHaveBeenCalled();
  });
});
