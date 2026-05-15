"use server";

import { db } from "@/db";
import { images, reports } from "@/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { invalidateOnHide } from "./_invalidation";

export async function hideImage(imageId: string): Promise<void> {
  await requireAdmin();

  const existing = db.select().from(images).where(eq(images.imageId, imageId)).all();
  if (existing.length === 0) {
    throw new Error(`unknown image_id: ${imageId}`);
  }

  db.transaction((tx) => {
    tx.update(images).set({ hidden: true }).where(eq(images.imageId, imageId)).run();
    tx.update(reports)
      .set({
        resolvedAt: new Date(),
        resolvedAction: "image-hidden",
      })
      .where(and(eq(reports.imageId, imageId), isNull(reports.resolvedAt)))
      .run();
  });

  invalidateOnHide();
}
