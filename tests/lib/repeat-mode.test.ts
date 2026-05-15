import { describe, it, expect } from "vitest";
import { applyRepeatMode } from "@/lib/repeat-mode";
import type { Image } from "@/db/schema";

const mk = (id: string, species: string, collection: string): Image => ({
  imageId: id, collectionId: collection, source: "inaturalist", sourceId: id,
  sourcePageUrl: "", imageUrl: "", filename: "", thumbnailFilename: "",
  mediumFilename: "", fileSizeBytes: 0, fileSha256: "", width: 0, height: 0,
  license: "cc-by-4.0", licenseUrl: null, photographerAttribution: null,
  photographer: null, institution: null, taxonOrder: null, taxonSpecies: species,
  commonName: species, subjectState: "wild", viewLabel: null, description: null,
  capturedDate: null, hidden: false, addedAt: new Date(),
  lifeStage: null, sex: null, hostOrganism: null, specimenCondition: null, rawMetadata: null,
  taxonSubgroup: null,
});

describe("applyRepeatMode", () => {
  const items = [
    mk("a1", "Beetle X", "col-A"),
    mk("a2", "Beetle X", "col-A"),  // same species, same collection
    mk("a3", "Beetle X", "col-B"),  // same species, different collection
    mk("b1", "Moth Y", "col-C"),
    mk("b2", "Moth Y", "col-C"),
  ];

  it("default returns full pool unchanged", () => {
    expect(applyRepeatMode(items, "default")).toHaveLength(5);
  });

  it("never-repeat-animals dedups by species", () => {
    const out = applyRepeatMode(items, "never-repeat-animals");
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.taxonSpecies).sort()).toEqual(["Beetle X", "Moth Y"]);
  });

  it("allow-different-angles keeps multi-angle from one collection per species", () => {
    const out = applyRepeatMode(items, "allow-different-angles");
    expect(out).toHaveLength(4);
    expect(out.map((i) => i.imageId).sort()).toEqual(["a1", "a2", "b1", "b2"]);
  });
});
