import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { SourceInfoChip } from "@/app/components/session/SourceInfoChip";
import type { Image } from "@/db/schema";

const img: Image = {
  imageId: "x", collectionId: "c", source: "inaturalist", sourceId: "x",
  sourcePageUrl: "https://example.com", imageUrl: "", filename: "",
  thumbnailFilename: "", mediumFilename: "", fileSizeBytes: 0, fileSha256: "",
  width: 0, height: 0, license: "cc-by-4.0", licenseUrl: null,
  photographerAttribution: "(c) Marie Cerda, CC BY 4.0", photographer: "Marie Cerda",
  institution: "iNaturalist", taxonOrder: "Coleoptera",
  taxonSpecies: "Harmonia axyridis", commonName: "Asian Lady Beetle",
  subjectState: "wild", viewLabel: null, description: null, capturedDate: null,
  lifeStage: null, sex: null, hostOrganism: null, specimenCondition: null, rawMetadata: null,
  taxonSubgroup: null,
  hidden: false, addedAt: new Date(),
};

describe("SourceInfoChip", () => {
  it("renders order badge + species + photographer + institution chip", async () => {
    const screen = await render(<SourceInfoChip image={img} visible />);
    // Common name moved to SessionTitle; chip carries scientific + attribution
    await expect.element(screen.getByText(/Harmonia axyridis/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/Coleoptera/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/Marie Cerda/i)).toBeInTheDocument();
    // Institution renders as a TileMetaChips pill (parity with gallery)
    await expect.element(screen.getByText(/iNaturalist/i).first()).toBeInTheDocument();
  });

  it("renders the source name (Bugwood / iNaturalist) as a chip line", async () => {
    const bw: Image = { ...img, source: "bugwood" };
    const screen = await render(<SourceInfoChip image={bw} visible />);
    await expect.element(screen.getByText(/Bugwood/i)).toBeInTheDocument();
  });

  it("renders the license code pill when present", async () => {
    const screen = await render(<SourceInfoChip image={img} visible />);
    const badge = screen.container.querySelector(".grid-item-license");
    expect(badge?.textContent).toBe("cc-by-4.0");
  });

  it("renders TileMetaChips with life stage / sex / institution when set", async () => {
    const detailed: Image = { ...img, lifeStage: "adult", sex: "female" };
    const screen = await render(<SourceInfoChip image={detailed} visible />);
    const chips = Array.from(
      screen.container.querySelectorAll(".grid-item-meta-chip"),
    );
    // Order: stage → sex → institution
    expect(chips.map((c) => c.textContent)).toEqual([
      "adult",
      "female",
      "iNaturalist",
    ]);
  });

  it("hides via opacity when visible=false", async () => {
    const screen = await render(<SourceInfoChip image={img} visible={false} />);
    const root = screen.container.firstChild as HTMLElement;
    expect(root.style.opacity).toBe("0");
  });
});
