import { describe, it, expect } from "vitest";
import { isOrderOnlyId } from "@/lib/text-format";

describe("isOrderOnlyId", () => {
  it("true when common name equals taxon order (case-insensitive)", () => {
    expect(isOrderOnlyId("butterflies, moths or skippers", "Lepidoptera", "Lepidoptera")).toBe(true);
    expect(isOrderOnlyId("Lepidoptera", "Lepidoptera", "Lepidoptera")).toBe(true);
    expect(isOrderOnlyId("Wasps, Bees, Ants and Sawflies", "Hymenoptera", "Hymenoptera")).toBe(true);
  });

  it("false when species is more specific than the order", () => {
    expect(isOrderOnlyId("Monarch", "Danaus plexippus", "Lepidoptera")).toBe(false);
    expect(isOrderOnlyId("Asian Longhorned Beetle", "Anoplophora glabripennis", "Coleoptera")).toBe(false);
  });

  it("false when species or order is missing", () => {
    expect(isOrderOnlyId(null, "Lepidoptera", "Lepidoptera")).toBe(false);
    expect(isOrderOnlyId("Lepidoptera", null, "Lepidoptera")).toBe(false);
    expect(isOrderOnlyId("Lepidoptera", "Lepidoptera", null)).toBe(false);
  });
});
