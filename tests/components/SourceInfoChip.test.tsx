import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
  hidden: false, addedAt: new Date(),
};

describe("SourceInfoChip", () => {
  it("renders order badge + species + photographer + institution", () => {
    render(<SourceInfoChip image={img} visible />);
    // Common name moved to SessionTitle; chip carries scientific + attribution
    expect(screen.getByText(/Harmonia axyridis/i)).toBeInTheDocument();
    expect(screen.getByText(/Coleoptera/i)).toBeInTheDocument();
    expect(screen.getByText(/Marie Cerda/i)).toBeInTheDocument();
    expect(screen.getByText(/iNaturalist/i)).toBeInTheDocument();
  });

  it("hides via opacity when visible=false", () => {
    const { container } = render(<SourceInfoChip image={img} visible={false} />);
    const root = container.firstChild as HTMLElement;
    expect(root.style.opacity).toBe("0");
  });
});
