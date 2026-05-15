import { describe, it, expect } from "vitest";
import { parseSubject, parseSubjectStrict, isSubjectType } from "@/lib/subject";

describe("parseSubject (lenient)", () => {
  it("accepts current values", () => {
    expect(parseSubject("wild")).toBe("wild");
    expect(parseSubject("captive")).toBe("captive");
    expect(parseSubject("specimen")).toBe("specimen");
    expect(parseSubject("all")).toBe("all");
  });

  it("remaps legacy 'nature' to 'wild'", () => {
    expect(parseSubject("nature")).toBe("wild");
  });

  it("remaps legacy 'both' to 'all'", () => {
    expect(parseSubject("both")).toBe("all");
  });

  it("defaults to 'all' for null/empty/unknown", () => {
    expect(parseSubject(null)).toBe("all");
    expect(parseSubject(undefined)).toBe("all");
    expect(parseSubject("")).toBe("all");
    expect(parseSubject("garbage")).toBe("all");
  });
});

describe("parseSubjectStrict", () => {
  it("returns null on unknown values", () => {
    expect(parseSubjectStrict("garbage")).toBeNull();
    expect(parseSubjectStrict("")).toBeNull();
    expect(parseSubjectStrict(null)).toBeNull();
  });

  it("returns mapped value for legacy aliases", () => {
    expect(parseSubjectStrict("nature")).toBe("wild");
    expect(parseSubjectStrict("both")).toBe("all");
  });

  it("returns value as-is for current types", () => {
    expect(parseSubjectStrict("captive")).toBe("captive");
  });
});

describe("isSubjectType", () => {
  it("returns true only for current types", () => {
    expect(isSubjectType("wild")).toBe(true);
    expect(isSubjectType("captive")).toBe(true);
    expect(isSubjectType("specimen")).toBe(true);
    expect(isSubjectType("all")).toBe(true);
  });

  it("returns false for legacy aliases", () => {
    expect(isSubjectType("nature")).toBe(false);
    expect(isSubjectType("both")).toBe(false);
  });
});
