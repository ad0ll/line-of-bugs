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

function unlinkIfExists(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function deleteImage(imageId: string): Promise<void> {
  await requireAdmin();

  const existing = db.select().from(images).where(eq(images.imageId, imageId)).all();
  if (existing.length === 0) {
    throw new Error(`unknown image_id: ${imageId}`);
  }
  const row = existing[0]!;

  // Delete DB row first — reports cascade via FK, FTS trigger fires.
  // If file unlinks fail mid-way, the row is still gone and gallery is consistent.
  db.delete(images).where(eq(images.imageId, imageId)).run();

  unlinkIfExists(safePath(row.filename));
  unlinkIfExists(safePath(row.mediumFilename));
  unlinkIfExists(safePath(row.thumbnailFilename));

  invalidateOnDelete();
}
