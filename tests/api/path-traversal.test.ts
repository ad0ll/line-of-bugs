import { describe, it, expect } from "vitest";
import { safeBasename } from "@/lib/streaming";

describe("safeBasename", () => {
  it("passes a normal filename through", () => {
    expect(safeBasename("foo_bar-1.jpg")).toBe("foo_bar-1.jpg");
  });

  it("rejects path traversal attempts (returns empty)", () => {
    expect(safeBasename("../etc/passwd")).toBe("");
  });

  it("rejects null bytes outright", () => {
    expect(safeBasename("ok.jpg\u0000.txt")).toBe("");
  });

  it("rejects backslash traversal attempts (returns empty)", () => {
    expect(safeBasename("..\\windows\\system32")).toBe("");
  });

  it("returns empty for empty input", () => {
    expect(safeBasename("")).toBe("");
  });
});
