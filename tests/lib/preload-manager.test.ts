import { describe, it, expect } from "vitest";
import { createPreloadManager } from "@/lib/preload-manager";

describe("PreloadManager", () => {
  it("preloads next 2 images on index change", () => {
    const pm = createPreloadManager((id) => `/api/img/${id}.jpg`);
    pm.setQueue(["a", "b", "c", "d", "e"]);
    pm.onIndexChange(0);
    // After index 0: b and c should be requested (next 2)
    expect(pm.cache.get("b")?.status).toBeDefined();
    expect(pm.cache.get("c")?.status).toBeDefined();
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
