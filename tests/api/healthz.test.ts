import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/healthz/route";

describe("GET /api/healthz", () => {
  it("returns 200 ok:true with an image count", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.images).toBe("number");
    expect(body.images).toBeGreaterThanOrEqual(0);
    expect(typeof body.ts).toBe("string");
  });
});
