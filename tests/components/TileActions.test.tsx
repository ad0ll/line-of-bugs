import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { TileActions } from "@/app/components/gallery/TileActions";

describe("TileActions overlay", () => {
  it("renders 'view full' link to our /api/img route", async () => {
    const screen = await render(
      <TileActions viewFullHref="/api/medium/test.jpg" sourceHref="https://example.com/source" sourceName="Bugwood" />,
    );
    const view = screen.getByRole("link", { name: /view full/i });
    const node = view.element() as HTMLAnchorElement;
    expect(node.getAttribute("href")).toBe("/api/medium/test.jpg");
    expect(node.getAttribute("target")).toBe("_blank");
  });

  it("renders 'source' link with external indicator + source name in label", async () => {
    const screen = await render(
      <TileActions viewFullHref="/api/medium/test.jpg" sourceHref="https://example.com/source" sourceName="iNaturalist" />,
    );
    const src = screen.getByRole("link", { name: /go to iNaturalist/i });
    const node = src.element() as HTMLAnchorElement;
    expect(node.getAttribute("href")).toBe("https://example.com/source");
    expect(node.getAttribute("target")).toBe("_blank");
  });
});
