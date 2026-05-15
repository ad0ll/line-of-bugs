import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHighResTimer } from "@/lib/hooks/useHighResTimer";

describe("useHighResTimer", () => {
  it("calls onTick with elapsed time when active", async () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    renderHook(() => useHighResTimer(1000, true, onTick, onEnd, "k1"));
    await new Promise((r) => setTimeout(r, 100));
    expect(onTick).toHaveBeenCalled();
    expect(onTick.mock.calls.at(-1)![0]).toBeGreaterThan(0);
  });

  it("calls onEnd when duration reached", async () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    renderHook(() => useHighResTimer(50, true, onTick, onEnd, "k1"));
    await new Promise((r) => setTimeout(r, 200));
    expect(onEnd).toHaveBeenCalled();
  });

  it("does not call onTick when active is false", async () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    renderHook(() => useHighResTimer(1000, false, onTick, onEnd, "k1"));
    await new Promise((r) => setTimeout(r, 100));
    expect(onTick).not.toHaveBeenCalled();
  });
});
