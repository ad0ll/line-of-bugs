import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scheduleIdle,
  cancelIdle,
  __resetHandleKindForTests,
} from "@/lib/hooks/useRequestIdleCallback";

describe("scheduleIdle / cancelIdle", () => {
  beforeEach(() => __resetHandleKindForTests());
  afterEach(() => vi.restoreAllMocks());

  it("uses window.requestIdleCallback when available", () => {
    const ric = vi.fn().mockReturnValue(123);
    vi.stubGlobal("requestIdleCallback", ric);
    const cb = vi.fn();
    const handle = scheduleIdle(cb, { timeout: 3000 });
    expect(handle).toBe(123);
    expect(ric).toHaveBeenCalledTimes(1);
    expect(ric.mock.calls[0]![1]).toEqual({ timeout: 3000 });
  });

  it("falls back to setTimeout when requestIdleCallback is undefined", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    const cb = vi.fn();
    vi.useFakeTimers();
    const handle = scheduleIdle(cb, { timeout: 3000 });
    expect(typeof handle).toBe("number");
    vi.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("cancelIdle routes a ric handle to cancelIdleCallback", () => {
    const cic = vi.fn();
    const ric = vi.fn().mockReturnValue(7);
    vi.stubGlobal("cancelIdleCallback", cic);
    vi.stubGlobal("requestIdleCallback", ric);
    const handle = scheduleIdle(() => {});
    cancelIdle(handle);
    expect(cic).toHaveBeenCalledWith(7);
  });

  it("cancelIdle routes a setTimeout handle to clearTimeout even if cancelIdleCallback is now defined", () => {
    // Schedule WITHOUT requestIdleCallback (polyfill branch)
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("cancelIdleCallback", undefined);
    vi.useFakeTimers();
    const cb = vi.fn();
    const handle = scheduleIdle(cb);

    // Now the polyfill globals reappear before we cancel — common in tests,
    // possible in race-conditions during page navigation. cancelIdle must
    // still route to clearTimeout because the handle was created by setTimeout.
    vi.stubGlobal("requestIdleCallback", vi.fn());
    const cic = vi.fn();
    vi.stubGlobal("cancelIdleCallback", cic);

    cancelIdle(handle);
    expect(cic).not.toHaveBeenCalled(); // wrong target — would be silent no-op
    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled(); // proves clearTimeout actually fired
    vi.useRealTimers();
  });

  it("removes the handle from the map after natural firing (no leak)", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.useFakeTimers();
    const handle = scheduleIdle(() => {});
    vi.advanceTimersByTime(200);
    // After the callback fires, cancelling that handle should be a no-op.
    cancelIdle(handle); // must not throw
    vi.useRealTimers();
  });
});
