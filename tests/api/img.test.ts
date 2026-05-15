import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GET } from "@/app/api/img/[name]/route";

describe("/api/img/[name]", () => {
  let knownFilename: string;
  beforeAll(() => {
    const files = fs.readdirSync(path.resolve("data/images"));
    knownFilename = files[0]!;
  });

  it("streams a known file with immutable cache header", async () => {
    const res = await GET(new Request(`http://localhost/api/img/${knownFilename}`), {
      params: Promise.resolve({ name: knownFilename }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(1000);
  });

  it("returns 404 for non-existent file", async () => {
    const res = await GET(new Request("http://localhost/api/img/nope.jpg"), {
      params: Promise.resolve({ name: "nope.jpg" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects path traversal attempts", async () => {
    const res = await GET(
      new Request("http://localhost/api/img/..%2F..%2Fetc%2Fpasswd"),
      { params: Promise.resolve({ name: "../../etc/passwd" }) },
    );
    expect(res.status).toBe(404);
  });
});
