import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shouldPreload, preloadThumbnails } from "@/lib/sketchfab/preload-utils";

describe("shouldPreload", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns true when navigator.connection is undefined (graceful default)", () => {
    vi.stubGlobal("navigator", {});
    expect(shouldPreload()).toBe(true);
  });

  it("returns true on fast connections", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g", saveData: false } });
    expect(shouldPreload()).toBe(true);
  });

  it("returns false when Save-Data is on", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g", saveData: true } });
    expect(shouldPreload()).toBe(false);
  });

  it("returns false on 2g / slow-2g", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: "2g", saveData: false } });
    expect(shouldPreload()).toBe(false);
    vi.stubGlobal("navigator", { connection: { effectiveType: "slow-2g", saveData: false } });
    expect(shouldPreload()).toBe(false);
  });
});

describe("preloadThumbnails", () => {
  let imageSrcs: string[] = [];
  let imageInstances: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }> = [];

  beforeEach(() => {
    imageSrcs = [];
    imageInstances = [];
    class FakeImage {
      _src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(v: string) {
        this._src = v;
        imageSrcs.push(v);
        imageInstances.push(this as never);
      }
      get src(): string { return this._src; }
    }
    vi.stubGlobal("Image", FakeImage);
  });
  afterEach(() => vi.restoreAllMocks());

  it("does nothing for an empty list", async () => {
    await preloadThumbnails([], { concurrency: 4 });
    expect(imageSrcs).toHaveLength(0);
  });

  it("caps concurrent loads at the given concurrency", async () => {
    const urls = Array.from({ length: 8 }, (_, i) => `https://t/${i}.jpg`);
    const promise = preloadThumbnails(urls, { concurrency: 3 });
    // Immediately after kicking off, only 3 images should be in flight
    expect(imageInstances.length).toBe(3);
    // Drain by always resolving the FIRST in-flight (length-snapshot, not
    // index-based — robust to non-deterministic queue ordering)
    while (imageInstances.length > 0) {
      const inst = imageInstances.shift()!;
      inst.onload?.();
      await Promise.resolve();
      await Promise.resolve(); // two ticks: one for then, one for queueing
    }
    await promise;
    expect(imageSrcs.sort()).toEqual(urls.sort());
  });

  it("treats onerror like onload (a 404 thumb shouldn't stall the queue)", async () => {
    const urls = ["a", "b"];
    const promise = preloadThumbnails(urls, { concurrency: 1 });
    expect(imageInstances).toHaveLength(1);
    imageInstances[0]!.onerror?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(imageInstances).toHaveLength(2);
    imageInstances[1]!.onload?.();
    await promise;
  });

  it("clears onload/onerror after each settle (closure leak prevention)", async () => {
    const promise = preloadThumbnails(["a"], { concurrency: 1 });
    const inst = imageInstances[0]!;
    inst.onload?.();
    await promise;
    expect(inst.onload).toBeNull();
    expect(inst.onerror).toBeNull();
  });

  it("stops launching new loads once the signal aborts", async () => {
    const urls = ["a", "b", "c", "d", "e"];
    const ctrl = new AbortController();
    const promise = preloadThumbnails(urls, { concurrency: 1, signal: ctrl.signal });
    expect(imageInstances).toHaveLength(1);
    imageInstances[0]!.onload?.();
    await Promise.resolve();
    await Promise.resolve();
    // Second load started
    expect(imageInstances).toHaveLength(2);
    ctrl.abort();
    imageInstances[1]!.onload?.();
    await promise;
    // No more loads after abort
    expect(imageInstances).toHaveLength(2);
  });
});
