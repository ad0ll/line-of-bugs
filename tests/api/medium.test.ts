import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GET } from "@/app/api/medium/[name]/route";

describe("/api/medium/[name]", () => {
  let knownFilename: string;
  beforeAll(() => {
    const files = fs.readdirSync(path.resolve("data/medium"));
    knownFilename = files[0]!;
  });

  it("streams a medium-tier file", async () => {
    const res = await GET(new Request(`http://localhost/api/medium/${knownFilename}`), {
      params: Promise.resolve({ name: knownFilename }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const contentLength = res.headers.get("content-length");
    expect(contentLength).not.toBeNull();
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(1000);
    expect(body.byteLength).toBeLessThan(1_000_000);
    expect(Number(contentLength)).toBe(body.byteLength);
  });

  it("returns 404 for missing file", async () => {
    const res = await GET(new Request("http://localhost/api/medium/none.jpg"), {
      params: Promise.resolve({ name: "none.jpg" }),
    });
    expect(res.status).toBe(404);
  });
});
