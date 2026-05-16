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
 */
export function streamImage(
  tierDir: "images" | "medium" | "thumbnails",
  rawName: string,
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
  // Bridge a Node fs.ReadStream into a Web ReadableStream — the Route Handler
  // contract is Web Streams, and Readable.toWeb is the canonical adapter.
  const nodeStream = fs.createReadStream(realPath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(webStream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
