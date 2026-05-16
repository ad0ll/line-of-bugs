"use server";

import { db } from "@/db";
import { images } from "@/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "@/lib/auth";
import { invalidateOnDelete } from "./_invalidation";

function safePath(rel: string): string {
  const cleaned = rel.replace(/\.\./g, "").replace(/^\/+/, "");
  return path.join(process.cwd(), "data", cleaned);
}

function unlinkBestEffort(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    // Admin deletes are rare; a stuck file (mode issue, NFS hiccup, etc.) is
    // not worth rolling back the DB delete over. Surface as a warning and
    // continue — the cleanup script can sweep orphans later.
    console.warn(`deleteImage: failed to unlink ${p}: ${(err as Error).message}`);
  }
}

export async function deleteImage(imageId: string): Promise<void> {
  await requireAdmin();

  // Project only the filename columns we need for unlink — skips
  // raw_metadata (the upstream archival blob, ~121 KB/row).
  const existing = db
    .select({
      filename: images.filename,
      mediumFilename: images.mediumFilename,
      thumbnailFilename: images.thumbnailFilename,
    })
    .from(images)
    .where(eq(images.imageId, imageId))
    .all();
  if (existing.length === 0) {
    throw new Error(`unknown image_id: ${imageId}`);
  }
  const row = existing[0]!;

  // Collect file paths from the row first, then delete the DB row in a
  // transaction. Reports cascade via FK; FTS trigger fires on DELETE.
  // File unlinks happen AFTER the DB commit — if one fails we log and keep
  // going so the gallery stays consistent (orphaned files are tolerable;
  // a stuck DB row with no files is not).
  const paths = [
    safePath(row.filename),
    safePath(row.mediumFilename),
    safePath(row.thumbnailFilename),
  ];

  db.transaction((tx) => {
    tx.delete(images).where(eq(images.imageId, imageId)).run();
  });

  for (const p of paths) unlinkBestEffort(p);

  invalidateOnDelete();
}
