import { describe, it, expect, vi, afterEach } from "vitest";
import { anySignal } from "@/lib/sketchfab/abort-helpers";

describe("anySignal", () => {
  afterEach(() => vi.restoreAllMocks());

  it("delegates to native AbortSignal.any when present", () => {
    const native = vi.fn().mockReturnValue(new AbortController().signal);
    vi.spyOn(AbortSignal, "any").mockImplementation(native as never);
    const a = new AbortController().signal;
    const b = new AbortController().signal;
    anySignal([a, b]);
    expect(native).toHaveBeenCalledWith([a, b]);
  });

  it("polyfill: aborts when any input signal aborts", () => {
    const original = AbortSignal.any;
    // @ts-expect-error — testing the polyfill branch
    delete AbortSignal.any;
    try {
      const a = new AbortController();
      const b = new AbortController();
      const merged = anySignal([a.signal, b.signal]);
      expect(merged.aborted).toBe(false);
      b.abort(new Error("from b"));
      expect(merged.aborted).toBe(true);
    } finally {
      AbortSignal.any = original;
    }
  });

  it("polyfill: short-circuits when an input is already aborted", () => {
    const original = AbortSignal.any;
    // @ts-expect-error
    delete AbortSignal.any;
    try {
      const a = new AbortController();
      a.abort();
      const b = new AbortController();
      const merged = anySignal([a.signal, b.signal]);
      expect(merged.aborted).toBe(true);
    } finally {
      AbortSignal.any = original;
    }
  });
});
