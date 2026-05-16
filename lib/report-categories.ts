// Single source of truth for report categories lives in `db/schema.ts` so the
// Drizzle column enum and the UI list can't drift. Re-export here for the
// historical `REPORT_CATEGORIES` constant name used across client + server.
export { reportCategories as REPORT_CATEGORIES, type ReportCategory } from "@/db/schema";

import type { ReportCategory } from "@/db/schema";

// Human-readable labels for the chip UI.
export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  "low-resolution": "low-resolution",
  "blurry": "blurry",
  "bug-too-small": "bug too small",
  "hard-to-see": "hard to see",
  "spooky": "spooky",
  "cropped": "cropped",
  "ai-generated": "ai-generated",
  "zoomed-out": "zoomed out",
  "wheres-the-bug": "where bug?",
  "other": "other",
};

export interface SubmitReportArgs {
  imageId: string;
  category: ReportCategory;
  message: string | null;
}
