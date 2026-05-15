import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GET } from "@/app/api/thumb/[name]/route";

describe("/api/thumb/[name]", () => {
  let knownFilename: string;
  beforeAll(() => {
    const files = fs.readdirSync(path.resolve("data/thumbnails"));
    knownFilename = files[0]!;
  });

  it("streams a thumbnail file", async () => {
    const res = await GET(new Request(`http://localhost/api/thumb/${knownFilename}`), {
      params: Promise.resolve({ name: knownFilename }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(1000);
    expect(body.byteLength).toBeLessThan(200_000);
  });

  it("returns 404 for missing file", async () => {
    const res = await GET(new Request("http://localhost/api/thumb/none.jpg"), {
      params: Promise.resolve({ name: "none.jpg" }),
    });
    expect(res.status).toBe(404);
  });
});
