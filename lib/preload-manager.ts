type Status = "loading" | "ok" | "error";

interface Entry {
  status: Status;
  img: HTMLImageElement | null;
}

export interface PreloadManager {
  setQueue: (ids: string[]) => void;
  onIndexChange: (idx: number) => void;
  markUsed: (id: string) => void;
  cache: {
    get: (id: string) => Entry | undefined;
    has: (id: string) => boolean;
  };
}

const PRELOAD_AHEAD = 2;
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
      // Preload forward (next N) AND backward (previous N) so backtracking
      // through the deck via ArrowLeft is instant. Previously only the
      // forward direction was hot, making back-nav hit the network.
      for (let i = 1; i <= PRELOAD_AHEAD; i++) {
        const next = queue[idx + i];
        if (next) ensure(next);
        const prev = queue[idx - i];
        if (prev) ensure(prev);
      }
    },
    markUsed(id) {
      ensure(id);
    },
    cache: {
      get: (id) => entries.get(id),
      has: (id) => entries.has(id),
    },
  };
}
