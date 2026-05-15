export const REPORT_CATEGORIES = [
  "low-resolution",
  "spooky",
  "cropped",
  "ai-generated",
  "zoomed-out",
  "wheres-the-bug",
  "other",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

// Human-readable labels for the chip UI.
export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  "low-resolution": "low-resolution",
  "spooky": "spooky",
  "cropped": "cropped",
  "ai-generated": "ai-generated",
  "zoomed-out": "zoomed out",
  "wheres-the-bug": "where's the bug?",
  "other": "other",
};

export interface SubmitReportArgs {
  imageId: string;
  category: ReportCategory;
  message: string | null;
}
