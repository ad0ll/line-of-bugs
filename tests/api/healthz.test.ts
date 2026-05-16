import { describe, it, expect, vi } from "vitest";
import { GET } from "@/app/api/healthz/route";
import { db } from "@/db";

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

  it("returns 503 with no leaked error details when DB query throws", async () => {
    const spy = vi.spyOn(db, "get").mockImplementation(() => {
      throw new Error("SECRET-DB-LEAK: connection refused at /var/lib/db");
    });
    // Silence console.error in the test so it doesn't pollute output.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await GET();
      expect(res.status).toBe(503);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ ok: false });
      expect(body.error).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("SECRET-DB-LEAK");
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
