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
    const contentLength = res.headers.get("content-length");
    expect(contentLength).not.toBeNull();
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(1000);
    expect(Number(contentLength)).toBe(body.byteLength);
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

  it("sets an ETag and Last-Modified on 200 responses", async () => {
    const res = await GET(new Request(`http://localhost/api/img/${knownFilename}`), {
      params: Promise.resolve({ name: knownFilename }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toMatch(/^"\d+-\d+"$/);
    expect(res.headers.get("last-modified")).not.toBeNull();
  });

  it("returns 304 when If-None-Match matches the current ETag", async () => {
    const first = await GET(new Request(`http://localhost/api/img/${knownFilename}`), {
      params: Promise.resolve({ name: knownFilename }),
    });
    await first.arrayBuffer(); // drain
    const etag = first.headers.get("etag")!;
    expect(etag).not.toBeNull();

    const second = await GET(
      new Request(`http://localhost/api/img/${knownFilename}`, {
        headers: { "If-None-Match": etag },
      }),
      { params: Promise.resolve({ name: knownFilename }) },
    );
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    // 304 must carry no body.
    const body = await second.arrayBuffer();
    expect(body.byteLength).toBe(0);
  });

  it("ignores a non-matching If-None-Match header", async () => {
    const res = await GET(
      new Request(`http://localhost/api/img/${knownFilename}`, {
        headers: { "If-None-Match": '"0-0"' },
      }),
      { params: Promise.resolve({ name: knownFilename }) },
    );
    expect(res.status).toBe(200);
  });
});
