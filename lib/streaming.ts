import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * Strip everything that isn't an allowed filename character, then collapse
 * leading dots so traversal sequences like "../" can't survive the cleanup.
 * NUL bytes always return empty — they can hide payloads from path checks.
 */
export function safeBasename(name: string): string {
  if (name.includes("\0")) return "";
  const stripped = name.replace(/[^a-z0-9_.-]/gi, "");
  // Reject if traversal patterns remain after stripping non-allowed chars.
  if (stripped.includes("..")) return "";
  return stripped;
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Stream a file from a tier directory.
 * Returns a Response with immutable cache headers, or null if missing.
 *
 * When `req` is provided, an `If-None-Match` header that matches the
 * file's strong ETag (`<mtimeMs>:<size>`) short-circuits to a 304.
 */
export function streamImage(
  tierDir: "images" | "medium" | "thumbnails",
  rawName: string,
  req?: Request,
): Response | null {
  const safe = safeBasename(rawName);
  if (!safe) return null;
  const base = path.resolve(process.cwd(), "data", tierDir);
  const filePath = path.join(base, safe);
  let realPath: string;
  try {
    realPath = fs.realpathSync(filePath);
  } catch {
    return null;
  }
  if (realPath !== filePath && !realPath.startsWith(base + path.sep)) {
    return null;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(realPath);
  } catch {
    return null;
  }
  const ext = path.extname(safe).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";

  // Strong validator built from mtime + size — same shape Nginx emits
  // by default. Floor the mtime to ms (some FS report sub-ms drift on
  // copy that would invalidate the cache without the data changing).
  const etag = `"${Math.floor(stat.mtimeMs)}-${stat.size}"`;
  const lastModified = new Date(stat.mtimeMs).toUTCString();

  if (req) {
    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch && etagMatches(ifNoneMatch, etag)) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Last-Modified": lastModified,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  // Bridge a Node fs.ReadStream into a Web ReadableStream — the Route Handler
  // contract is Web Streams, and Readable.toWeb is the canonical adapter.
  const nodeStream = fs.createReadStream(realPath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(webStream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      "Last-Modified": lastModified,
    },
  });
}

/**
 * Compare an If-None-Match header value against our generated ETag.
 * Per RFC 7232: the header is a comma-separated list; "*" matches
 * any existing resource. Weak-prefix is stripped for the comparison.
 */
function etagMatches(header: string, etag: string): boolean {
  if (header.trim() === "*") return true;
  const normalize = (t: string) => t.trim().replace(/^W\//, "");
  const ours = normalize(etag);
  return header.split(",").some((tag) => normalize(tag) === ours);
}
