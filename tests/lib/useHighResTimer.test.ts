import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
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
    renderHook(() => useHighResTimer(1000, true, onTick, onEnd, "k1"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onTick).toHaveBeenCalled();
    expect(onTick.mock.calls.at(-1)![0]).toBeGreaterThan(0);
  });

  it("calls onEnd when duration reached", async () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    renderHook(() => useHighResTimer(50, true, onTick, onEnd, "k1"));
    await vi.advanceTimersByTimeAsync(200);
    expect(onEnd).toHaveBeenCalled();
  });

  it("does not call onTick when active is false", async () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    renderHook(() => useHighResTimer(1000, false, onTick, onEnd, "k1"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onTick).not.toHaveBeenCalled();
  });

  it("pauses when document becomes hidden and resumes when visible", async () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    // Default JSDOM: document.hidden === false.
    renderHook(() => useHighResTimer(2000, true, onTick, onEnd, "k1"));
    await vi.advanceTimersByTimeAsync(120);
    const callsBeforeHide = onTick.mock.calls.length;
    expect(callsBeforeHide).toBeGreaterThan(0);

    // Simulate hide.
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    // After hiding the loop should stop scheduling new RAFs.
    await vi.advanceTimersByTimeAsync(500);
    const callsAfterHide = onTick.mock.calls.length;
    // Some implementations may fire one final tick on the queued frame; tolerate
    // a delta of at most 1 call.
    expect(callsAfterHide - callsBeforeHide).toBeLessThanOrEqual(1);

    // Simulate re-show — timer should resume.
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(200);
    expect(onTick.mock.calls.length).toBeGreaterThan(callsAfterHide);
    // Reset for downstream tests.
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });

  it("picks up latest onTick callback without restarting the timer", async () => {
    const onTickA = vi.fn();
    const onTickB = vi.fn();
    const onEnd = vi.fn();
    const { rerender } = renderHook(
      ({ tick }: { tick: (elapsed: number) => void }) =>
        useHighResTimer(2000, true, tick, onEnd, "k1"),
      { initialProps: { tick: onTickA } },
    );
    await vi.advanceTimersByTimeAsync(80);
    expect(onTickA).toHaveBeenCalled();
    rerender({ tick: onTickB });
    await vi.advanceTimersByTimeAsync(80);
    expect(onTickB).toHaveBeenCalled();
  });
});
