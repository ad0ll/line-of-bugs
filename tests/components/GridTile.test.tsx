import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { GridTile } from "@/app/gallery/_components/GridTile";

const BASE_ROW = {
  image_id: "test-id",
  collection_id: "col-1",
  source: "inaturalist",
  source_page_url: "https://example.com/page",
  image_url: "https://example.com/img.jpg",
  thumbnail_filename: "thumbs/x.jpg",
  medium_filename: "medium/x.jpg",
  filename: "x.jpg",
  width: 1024,
  height: 768,
  taxon_order: "Lepidoptera",
  taxon_species: "Danaus plexippus",
  common_name: "monarch",
  subject_state: "wild",
  institution: null,
  license: "CC-BY-NC",
  collection_index: 1,
  collection_size: 1,
};

describe("GridTile", () => {
  it("collapses order-only iNat IDs and drops the taxon-group chip", async () => {
    const row = {
      ...BASE_ROW,
      common_name: "butterflies, moths or skippers",
      taxon_species: "Lepidoptera",
      taxon_order: "Lepidoptera",
    };
    const screen = await render(<GridTile row={row as any} />);
    await expect.element(screen.getByText(/Butterflies, Moths Or Skippers/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/\(order\)/i)).toBeInTheDocument();
    // No scientific repeat, no taxon-group chip (OrderBadge)
    const sci = screen.container.querySelector(".grid-item-species");
    expect(sci).toBeNull();
    const chip = screen.container.querySelector(".order-badge");
    expect(chip).toBeNull();
  });

  it("shows common + scientific when species is more specific", async () => {
    const screen = await render(<GridTile row={BASE_ROW as any} />);
    await expect.element(screen.getByText(/Monarch/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/Danaus plexippus/i)).toBeInTheDocument();
    // L4: order badge appears in the meta row for normal (non-order-only)
    // species per docs/design-system.md gallery info hierarchy.
    const chip = screen.container.querySelector(".order-badge");
    expect(chip?.textContent).toBe("Lepidoptera");
  });

  it("renders the license badge bottom-left when license is present", async () => {
    const screen = await render(<GridTile row={BASE_ROW as any} />);
    const badge = screen.container.querySelector(".grid-item-license");
    expect(badge?.textContent).toBe("CC-BY-NC");
    expect(badge?.getAttribute("aria-label")).toBe("license CC-BY-NC");
  });

  it("omits the license badge when the row has no license string", async () => {
    const row = { ...BASE_ROW, license: "" };
    const screen = await render(<GridTile row={row as any} />);
    expect(screen.container.querySelector(".grid-item-license")).toBeNull();
  });
});
