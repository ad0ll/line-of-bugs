import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { SessionTitle } from "@/app/components/session/SessionTitle";

describe("SessionTitle", () => {
  it("collapses to one display when common name = order (order-only iNat ID)", async () => {
    const image = {
      imageId: "test-id",
      commonName: "butterflies, moths or skippers",
      taxonSpecies: "Lepidoptera",
      taxonOrder: "Lepidoptera",
    };
    const screen = await render(<SessionTitle image={image as any} />);
    // Common name shows, with "(order)" annotation
    await expect.element(screen.getByText(/Butterflies, Moths Or Skippers/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/\(order\)/i)).toBeInTheDocument();
    // Scientific italic should NOT appear separately when it would duplicate
    const sciNodes = screen.container.querySelectorAll(".session-title-secondary");
    expect(sciNodes.length).toBe(0);
  });

  it("shows both common + scientific when species is more specific", async () => {
    const image = {
      imageId: "test-id",
      commonName: "monarch",
      taxonSpecies: "Danaus plexippus",
      taxonOrder: "Lepidoptera",
    };
    const screen = await render(<SessionTitle image={image as any} />);
    await expect.element(screen.getByText(/Monarch/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/Danaus plexippus/i)).toBeInTheDocument();
  });
});
