type Status = "loading" | "ok" | "error";

interface Entry {
  status: Status;
  img: HTMLImageElement | null;
}

export interface PreloadManager {
  setQueue: (ids: string[]) => void;
  onIndexChange: (idx: number) => void;
  markUsed: (id: string) => void;
  /** True when the image for `id` is fully decoded and ready to render
   *  immediately — used by the ramp-up handler (Phase F) to decide
   *  whether to show the "whoa so fast" overlay while preload catches
   *  up. Returns false for unknown ids and for in-flight loads. */
  isReady: (id: string) => boolean;
  cache: {
    get: (id: string) => Entry | undefined;
    has: (id: string) => boolean;
  };
}

// Forward window dominates because gesture-drawing sessions are mostly
// linear (next/next/next). Keep just one slot behind for the occasional
// ArrowLeft backtrack.
const PRELOAD_AHEAD = 3;
const PRELOAD_BEHIND = 1;
const LRU_MAX = 8;

export function createPreloadManager(
  urlBuilder: (id: string) => string,
): PreloadManager {
  const entries = new Map<string, Entry>();
  const order: string[] = []; // LRU: tail = most recent
  let queue: string[] = [];

  function touch(id: string): void {
    const i = order.indexOf(id);
    if (i !== -1) order.splice(i, 1);
    order.push(id);
    while (order.length > LRU_MAX) {
      const evicted = order.shift()!;
      entries.delete(evicted);
    }
  }

  function ensure(id: string): void {
    if (entries.has(id)) {
      touch(id);
      return;
    }
    if (typeof Image === "undefined") {
      // Test/SSR fallback — record loading status without DOM
      entries.set(id, { status: "loading", img: null });
      touch(id);
      return;
    }
    const img = new Image();
    const entry: Entry = { status: "loading", img };
    entries.set(id, entry);
    touch(id);
    img.onload = () => {
      entry.status = "ok";
    };
    img.onerror = () => {
      entry.status = "error";
    };
    img.src = urlBuilder(id);
  }

  return {
    setQueue(ids) {
      queue = [...ids];
    },
    onIndexChange(idx) {
      // Forward preload — next N slides so the user never sees a blank
      // frame on advance.
      for (let i = 1; i <= PRELOAD_AHEAD; i++) {
        const next = queue[idx + i];
        if (next) ensure(next);
      }
      // Backward preload — keep prev N hot so ArrowLeft backtracks
      // don't hit the network. Smaller window than forward since
      // sessions are mostly linear.
      for (let i = 1; i <= PRELOAD_BEHIND; i++) {
        const prev = queue[idx - i];
        if (prev) ensure(prev);
      }
    },
    markUsed(id) {
      ensure(id);
    },
    isReady(id) {
      return entries.get(id)?.status === "ok";
    },
    cache: {
      get: (id) => entries.get(id),
      has: (id) => entries.has(id),
    },
  };
}
