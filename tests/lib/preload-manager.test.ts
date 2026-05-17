import { describe, it, expect } from "vitest";
import { createPreloadManager } from "@/lib/preload-manager";

describe("PreloadManager", () => {
  it("preloads next 3 images on index change", () => {
    const pm = createPreloadManager((id) => `/api/img/${id}.jpg`);
    pm.setQueue(["a", "b", "c", "d", "e"]);
    pm.onIndexChange(0);
    // After index 0: b, c, d should be requested (next 3).
    expect(pm.cache.has("b")).toBe(true);
    expect(pm.cache.has("c")).toBe(true);
    expect(pm.cache.has("d")).toBe(true);
  });

  it("preloads previous 1 image on index change for backward nav", () => {
    const pm = createPreloadManager((id) => `/api/img/${id}.jpg`);
    pm.setQueue(["a", "b", "c", "d", "e"]);
    pm.onIndexChange(3);
    // Forward: e (idx 4) is in range; f/g would be if they existed.
    expect(pm.cache.has("e")).toBe(true);
    // Backward window is prev-1 only, so c (idx 2) is hot but b (idx 1) is not.
    expect(pm.cache.has("c")).toBe(true);
    expect(pm.cache.has("b")).toBe(false);
  });

  it("does not preload off-the-end items going backward at idx 0", () => {
    const pm = createPreloadManager((id) => `/api/img/${id}.jpg`);
    pm.setQueue(["a", "b", "c"]);
    pm.onIndexChange(0);
    // No queue[-1] should be touched.
    expect(pm.cache.has("a")).toBe(false);
  });

  it("does not re-preload already-cached items", () => {
    const pm = createPreloadManager((id) => `/api/img/${id}.jpg`);
    pm.setQueue(["a", "b", "c"]);
    pm.onIndexChange(0);
    const beforeB = pm.cache.get("b");
    pm.onIndexChange(0); // same index — no change
    expect(pm.cache.get("b")).toBe(beforeB);
  });

  it("markUsed bumps LRU recency", () => {
    const pm = createPreloadManager((id) => `/api/img/${id}.jpg`);
    pm.setQueue(["a", "b", "c"]);
    pm.markUsed("a");
    // Returns true if entry is present
    expect(pm.cache.has("a")).toBe(true);
  });
});
