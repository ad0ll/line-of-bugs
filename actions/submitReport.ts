"use server";

import { db } from "@/db";
import { images, reports } from "@/db/schema";
import { eq } from "drizzle-orm";
import { invalidateOnReportSubmit } from "./_invalidation";

export const REPORT_CATEGORIES = [
  "low-resolution",
  "spooky",
  "cropped",
  "ai-generated",
  "other",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export interface SubmitReportArgs {
  imageId: string;
  category: ReportCategory;
  message: string | null;
}

const MESSAGE_MAX = 250;

export async function submitReport(args: SubmitReportArgs): Promise<void> {
  if (!REPORT_CATEGORIES.includes(args.category)) {
    throw new Error(`invalid category: ${args.category}`);
  }

  const existing = db.select().from(images).where(eq(images.imageId, args.imageId)).all();
  if (existing.length === 0) {
    throw new Error(`unknown image_id: ${args.imageId}`);
  }

  let message: string | null = null;
  if (args.category === "other" && args.message) {
    message = args.message.slice(0, MESSAGE_MAX);
  }

  db.insert(reports).values({
    imageId: args.imageId,
    category: args.category,
    message,
  }).run();

  invalidateOnReportSubmit();
}
