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
