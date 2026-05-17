import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchSketchfabWithTimeout,
  SketchfabTimeoutError,
} from "@/lib/sketchfab/fetch-with-timeout";

describe("fetchSketchfabWithTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the parsed JSON when the response is fast", async () => {
    const body = { hits: [{ uid: "u1", name: "Bee" }], rawHadResults: true };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    const result = await fetchSketchfabWithTimeout(
      "Apis",
      "bee",
      new AbortController().signal,
    );
    expect(result).toEqual(body);
  });

  it("throws SketchfabTimeoutError after 5s when the response hangs", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const promise = fetchSketchfabWithTimeout(
      "Apis",
      "bee",
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).rejects.toBeInstanceOf(SketchfabTimeoutError);
  });

  it("aborts when the caller's AbortSignal fires before the timeout", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = new AbortController();
    const promise = fetchSketchfabWithTimeout("Apis", "bee", ctrl.signal);
    ctrl.abort();
    await expect(promise).rejects.toThrow();
    const callArgs = fetchMock.mock.calls[0]!;
    const passedSignal = (callArgs[1] as RequestInit).signal as AbortSignal;
    expect(passedSignal.aborted).toBe(true);
  });

  it("throws non-timeout error untouched (network failure)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network down");
    }));
    await expect(
      fetchSketchfabWithTimeout("Apis", "bee", new AbortController().signal),
    ).rejects.toThrow(/network down/);
  });
});
