import { describe, it, expect, beforeEach } from "vitest";
import { setPool, getPool, sweepExpired, _clearAll } from "@/lib/session-pools";
import type { Image } from "@/db/schema";

const fakeImg = (id: string): Image => ({
  imageId: id, collectionId: "c", source: "inaturalist", sourceId: id,
  sourcePageUrl: "", imageUrl: "", filename: "", thumbnailFilename: "",
  mediumFilename: "", fileSizeBytes: 0, fileSha256: "", width: 100, height: 100,
  license: "cc-by-4.0", licenseUrl: null, photographerAttribution: null,
  photographer: null, institution: null, taxonOrder: null, taxonSpecies: null,
  commonName: null, subjectState: "wild", viewLabel: null, description: null,
  capturedDate: null, hidden: false, addedAt: new Date(),
  lifeStage: null, sex: null, hostOrganism: null, specimenCondition: null, rawMetadata: null,
  taxonSubgroup: null,
});

describe("session-pools", () => {
  beforeEach(() => _clearAll());

  it("stores and retrieves a pool by sessionId", () => {
    const items = [fakeImg("a"), fakeImg("b")];
    setPool("s1", items);
    expect(getPool("s1")?.items).toHaveLength(2);
    expect(getPool("s1")?.items[0]!.imageId).toBe("a");
  });

  it("returns undefined for unknown sessionId", () => {
    expect(getPool("nope")).toBeUndefined();
  });

  it("sweepExpired removes pools older than the TTL", () => {
    setPool("old", [fakeImg("x")]);
    // Manually backdate
    const pool = getPool("old")!;
    pool.createdAt = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
    sweepExpired();
    expect(getPool("old")).toBeUndefined();
  });
});
