import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSketchfabPreloader } from "@/lib/hooks/useSketchfabPreloader";
import { sketchfabQueryKey } from "@/lib/sketchfab/query-keys";
import type { SketchfabSearchResponse } from "@/lib/sketchfab/types";

const FAKE_RESPONSE: SketchfabSearchResponse = {
  hits: [
    {
      uid: "u1", name: "a", author: "x", authorUsername: "x",
      thumbnailUrl: "https://t/1.jpg", viewerUrl: "https://v/1",
      licenseSlug: "by", matchedBy: "scientific",
    },
    {
      uid: "u2", name: "b", author: "x", authorUsername: "x",
      thumbnailUrl: "https://t/2.jpg", viewerUrl: "https://v/2",
      licenseSlug: "by", matchedBy: "common",
    },
  ],
  rawHadResults: true,
} as SketchfabSearchResponse;

function Harness({
  items, idx,
}: { items: Array<{ taxonSpecies: string; commonName: string }>; idx: number }) {
  useSketchfabPreloader(items, idx);
  return <div>harness</div>;
}

function makeQc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function wrap(qc: QueryClient, node: React.ReactNode) {
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("useSketchfabPreloader", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let imageSrcs: string[];

  beforeEach(() => {
    imageSrcs = [];
    class FakeImage {
      _src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(v: string) {
        this._src = v;
        imageSrcs.push(v);
        // Resolve on next microtask
        queueMicrotask(() => this.onload?.());
      }
      get src(): string { return this._src; }
    }
    vi.stubGlobal("Image", FakeImage);
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(FAKE_RESPONSE), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // Run idle callbacks synchronously
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => { cb(); return 0; });
    vi.stubGlobal("cancelIdleCallback", () => {});
    vi.stubGlobal("navigator", {
      connection: { effectiveType: "4g", saveData: false },
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true, value: "visible",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("prefetches idx+1, idx+2, idx+3 JSON + their thumbnails", async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      taxonSpecies: `Sci${i}`, commonName: `Common${i}`,
    }));
    const qc = makeQc();
    await wrap(qc, <Harness items={items} idx={0} />);
    await new Promise((r) => setTimeout(r, 50));
    const speciesFetched = fetchMock.mock.calls
      .map((c) => new URL(c[0] as string).searchParams.get("scientific"))
      .filter(Boolean) as string[];
    expect(new Set(speciesFetched)).toEqual(new Set(["Sci1", "Sci2", "Sci3"]));
    // 3 species × 2 thumbnails each = 6
    expect(imageSrcs.length).toBe(6);
  });

  it("skips the thumbnail chain when the JSON prefetch fails", async () => {
    // Honest framing: prefetchQuery still writes an `error` state to the
    // cache on failure (it just doesn't write `data`). React Query's
    // default refetchOnMount: true means the panel's later useQuery will
    // refetch on open — brief isError flash is acceptable for the rare
    // preload-failure case. What we DO guarantee: no thumbnail loads
    // fire when there's no JSON data to derive URLs from.
    fetchMock.mockRejectedValue(new Error("network down"));
    const items = [
      { taxonSpecies: "A", commonName: "a" },
      { taxonSpecies: "B", commonName: "b" },
    ];
    const qc = makeQc();
    await wrap(qc, <Harness items={items} idx={0} />);
    await new Promise((r) => setTimeout(r, 50));
    // getQueryData returns undefined on failure (data was never written).
    // This is the gate the hook reads to decide whether to chain to thumbs.
    expect(qc.getQueryData(sketchfabQueryKey("B", "b"))).toBeUndefined();
    // No thumbnails preloaded since JSON failed.
    expect(imageSrcs).toEqual([]);
  });

  it("skips entirely when shouldPreload returns false (Save-Data on)", async () => {
    vi.stubGlobal("navigator", {
      connection: { effectiveType: "4g", saveData: true },
    });
    const items = Array.from({ length: 5 }, (_, i) => ({
      taxonSpecies: `Sci${i}`, commonName: `Common${i}`,
    }));
    const qc = makeQc();
    await wrap(qc, <Harness items={items} idx={0} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(imageSrcs).toEqual([]);
  });

  it("skips entirely when the tab is hidden", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true, value: "hidden",
    });
    const items = Array.from({ length: 5 }, (_, i) => ({
      taxonSpecies: `Sci${i}`, commonName: `Common${i}`,
    }));
    const qc = makeQc();
    await wrap(qc, <Harness items={items} idx={0} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't preload past the end of the queue", async () => {
    const items = [
      { taxonSpecies: "A", commonName: "a" },
      { taxonSpecies: "B", commonName: "b" },
    ];
    const qc = makeQc();
    await wrap(qc, <Harness items={items} idx={0} />);
    await new Promise((r) => setTimeout(r, 50));
    const speciesFetched = fetchMock.mock.calls
      .map((c) => new URL(c[0] as string).searchParams.get("scientific"));
    expect(speciesFetched).toEqual(["B"]);
  });

  it("skips items whose taxonSpecies or commonName is empty", async () => {
    const items = [
      { taxonSpecies: "Sci0", commonName: "c0" },
      { taxonSpecies: "Sci1", commonName: "" },
      { taxonSpecies: "",     commonName: "c2" },
      { taxonSpecies: "Sci3", commonName: "c3" },
    ];
    const qc = makeQc();
    await wrap(qc, <Harness items={items} idx={0} />);
    await new Promise((r) => setTimeout(r, 50));
    const speciesFetched = fetchMock.mock.calls
      .map((c) => new URL(c[0] as string).searchParams.get("scientific"));
    expect(speciesFetched).toEqual(["Sci3"]);
  });

  it("short-circuits the thumbnail chain when unmounted before fetch settles", async () => {
    // This is the actual memory-leak guard the hook provides on unmount.
    // We do NOT cancel in-flight fetches (React Query owns those signals,
    // and `qc.cancelQueries` would also affect the panel's same-key
    // useQuery if it happens to be mounted concurrently). Instead, we
    // rely on ctrl.signal.aborted to short-circuit the .then chain that
    // would otherwise spawn up to PRELOAD_AHEAD × hits-per-species
    // Image objects post-unmount.
    //
    // In-flight fetches still complete (bounded by the 5s timeout in
    // fetch-with-timeout.ts) and their results write to React Query's
    // cache — that's harmless and could even be useful if the user
    // navigates back. The bandwidth cost is bounded.
    const resolvers: Array<(r: Response) => void> = [];
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => { resolvers.push(resolve); }),
    );
    const items = Array.from({ length: 10 }, (_, i) => ({
      taxonSpecies: `Sci${i}`, commonName: `Common${i}`,
    }));
    const qc = makeQc();
    const screen = await wrap(qc, <Harness items={items} idx={0} />);

    // Wait deterministically for the in-flight fetch count to reach 3,
    // instead of relying on a heuristic setTimeout. vi.waitFor polls
    // until the assertion passes (or times out after 1s default).
    await vi.waitFor(() => expect(resolvers).toHaveLength(3));
    expect(imageSrcs).toEqual([]);

    // Unmount BEFORE the fetches settle — sets ctrl.signal.aborted = true.
    screen.unmount();

    // Now release the fetches. Without the cleanup guard the .then chain
    // would fire and start preloading 6 thumbnails.
    resolvers.forEach((r) =>
      r(new Response(JSON.stringify(FAKE_RESPONSE), { status: 200 })),
    );

    // Drain microtask queue robustly: enough rounds for fetch.then →
    // RQ internals → hook's .then → getQueryData (sync) → would-be
    // preloadThumbnails kickoff. If the chain DID fire, imageSrcs
    // would populate within these microtasks.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // Zero thumbnails — proves the short-circuit worked.
    expect(imageSrcs).toEqual([]);
  });

  it("cancels pending idle handles on unmount (before prefetch starts)", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("cancelIdleCallback", cancel);
    // Return real handles but never invoke the callback
    let nextHandle = 100;
    vi.stubGlobal("requestIdleCallback", () => nextHandle++);
    const items = Array.from({ length: 10 }, (_, i) => ({
      taxonSpecies: `Sci${i}`, commonName: `Common${i}`,
    }));
    const qc = makeQc();
    const screen = await wrap(qc, <Harness items={items} idx={0} />);
    screen.unmount();
    expect(cancel).toHaveBeenCalledTimes(3);
    // Also verify no fetches happened (since idle never fired)
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
