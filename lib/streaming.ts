import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * Strip everything that isn't an allowed filename character, then collapse
 * leading dots so traversal sequences like "../" can't survive the cleanup.
 */
export function safeBasename(name: string): string {
  const stripped = name.replace(/[^a-z0-9_.-]/gi, "");
  // Reject if traversal patterns remain after stripping non-allowed chars.
  if (stripped.includes("..")) return "";
  return stripped;
}

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
  const filePath = path.join(process.cwd(), "data", tierDir, safe);
  if (!fs.existsSync(filePath)) return null;
  // Bridge a Node fs.ReadStream into a Web ReadableStream — the Route Handler
  // contract is Web Streams, and Readable.toWeb is the canonical adapter.
  const nodeStream = fs.createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(webStream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
