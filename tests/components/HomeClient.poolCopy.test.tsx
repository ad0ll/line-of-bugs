import { describe, it, expect, vi, afterEach } from "vitest";
import { POOL_COPY_PRIMARY, POOL_COPY_RARE, pickPoolCopy } from "@/app/components/home/HomeClient";

describe("HomeClient pickPoolCopy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns primary copy 'you have {n} bugs to draw' by default", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(pickPoolCopy()).toBe(POOL_COPY_PRIMARY);
    expect(POOL_COPY_PRIMARY).toMatch(/you have/);
    expect(POOL_COPY_PRIMARY).toMatch(/bugs to draw/);
  });

  it("returns rare copy '{n} bugs are waiting' when Math.random is below 1e-6", () => {
    vi.spyOn(Math, "random").mockReturnValue(1e-7);
    expect(pickPoolCopy()).toBe(POOL_COPY_RARE);
    expect(POOL_COPY_RARE).toMatch(/bugs are waiting/);
  });

  it("primary copy contains the {n} placeholder for count substitution", () => {
    expect(POOL_COPY_PRIMARY).toContain("{n}");
    expect(POOL_COPY_RARE).toContain("{n}");
  });
});
