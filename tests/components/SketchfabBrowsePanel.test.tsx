import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SketchfabBrowsePanel } from "@/app/components/session/SketchfabBrowsePanel";
import { SketchfabTimeoutError } from "@/lib/sketchfab/fetch-with-timeout";

vi.mock("@/lib/sketchfab/fetch-with-timeout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sketchfab/fetch-with-timeout")>();
  return {
    ...actual,
    fetchSketchfabWithTimeout: vi.fn(actual.fetchSketchfabWithTimeout),
  };
});

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const hit = {
  uid: "u1",
  name: "Apis mellifera CT",
  author: "ETAIN",
  authorUsername: "etain",
  thumbnailUrl: "https://media.sketchfab.com/thumb-256.jpg",
  viewerUrl: "https://sketchfab.com/3d-models/u1",
  licenseSlug: "by",
  matchedBy: "scientific" as const,
};

describe("SketchfabBrowsePanel", () => {
  it("shows loading skeletons before data arrives", async () => {
    vi.stubGlobal("fetch", () => new Promise(() => {})); // never resolves
    const screen = await wrap(
      <SketchfabBrowsePanel scientific="Apis mellifera" common="honey bee" open onClose={() => {}} />,
    );
    const skeletons = screen.container.querySelectorAll('[data-testid="sketchfab-skeleton"]');
    // 6 = LCM(1,2,3) so every breakpoint shows complete rows.
    expect(skeletons).toHaveLength(6);
  });

  it("renders thumbnails when results arrive", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ hits: [hit], rawHadResults: true })),
    );
    const screen = await wrap(
      <SketchfabBrowsePanel scientific="Apis mellifera" common="honey bee" open onClose={() => {}} />,
    );
    const link = screen.getByRole("link", { name: /Apis mellifera CT/i });
    await expect.element(link).toBeInTheDocument();
    await expect.element(link).toHaveAttribute("href", hit.viewerUrl);
    await expect.element(link).toHaveAttribute("target", "_blank");
    await expect.element(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    await expect.element(screen.getByText("@etain")).toBeInTheDocument();
  });

  it("renders the empty state when there are no hits", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ hits: [], rawHadResults: false })),
    );
    const screen = await wrap(
      <SketchfabBrowsePanel scientific="X" common="y" open onClose={() => {}} />,
    );
    await expect.element(screen.getByText(/no 3d models/i)).toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /search sketchfab anyway/i }))
      .toHaveAttribute("href", expect.stringContaining("sketchfab.com/search"));
  });

  it("returns null and fires no fetch when open=false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const screen = await wrap(
      <SketchfabBrowsePanel scientific="X" common="y" open={false} onClose={() => {}} />,
    );
    expect(screen.container.firstChild).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the error state when fetch rejects", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("network down")));
    const screen = await wrap(
      <SketchfabBrowsePanel scientific="X" common="y" open onClose={() => {}} />,
    );
    await expect.element(screen.getByText(/couldn.t reach sketchfab/i)).toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /search sketchfab in a new tab/i }))
      .toHaveAttribute("href", expect.stringContaining("sketchfab.com/search"));
  });

  it("shows the timeout-specific message when fetch exceeds 5s", async () => {
    const { fetchSketchfabWithTimeout } = await import("@/lib/sketchfab/fetch-with-timeout");
    // Mock the timeout helper to reject with SketchfabTimeoutError
    (fetchSketchfabWithTimeout as any).mockRejectedValue(
      new SketchfabTimeoutError(),
    );
    const screen = await wrap(
      <SketchfabBrowsePanel
        scientific="Slow species"
        common="slow bug"
        open
        onClose={() => {}}
      />,
    );
    // Wait for the error state to render
    await expect.element(
      screen.getByText(/couldn.t find anything on sketchfab/i),
    ).toBeInTheDocument();
    await expect.element(
      screen.getByRole("link", { name: /try the manual search/i }),
    ).toBeInTheDocument();
  });
});
