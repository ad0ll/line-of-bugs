import { revalidateTag } from "next/cache";

export function invalidateOnReportSubmit(): void {
  revalidateTag("reports", "max");
  revalidateTag("gallery-results", "max");
  revalidateTag("images-stats", "max");
}

export function invalidateOnDismiss(): void {
  revalidateTag("reports", "max");
  revalidateTag("gallery-results", "max");
}

export function invalidateOnHide(): void {
  revalidateTag("reports", "max");
  revalidateTag("gallery-results", "max");
  revalidateTag("images-stats", "max");
}

export function invalidateOnDelete(): void {
  revalidateTag("reports", "max");
  revalidateTag("gallery-results", "max");
  revalidateTag("images-stats", "max");
  revalidateTag("species-index", "max");
}
