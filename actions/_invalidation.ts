import { revalidateTag } from "next/cache";

// expire: 0 forces immediate invalidation (vs 'max' which is stale-while-revalidate).
// Admin mutations must be visible on the very next request.
const EXPIRE_NOW = { expire: 0 } as const;

export function invalidateOnReportSubmit(): void {
  revalidateTag("reports", EXPIRE_NOW);
  revalidateTag("gallery-results", EXPIRE_NOW);
  revalidateTag("images-stats", EXPIRE_NOW);
}

export function invalidateOnDismiss(): void {
  revalidateTag("reports", EXPIRE_NOW);
  revalidateTag("gallery-results", EXPIRE_NOW);
}

export function invalidateOnHide(): void {
  revalidateTag("reports", EXPIRE_NOW);
  revalidateTag("gallery-results", EXPIRE_NOW);
  revalidateTag("images-stats", EXPIRE_NOW);
}

export function invalidateOnDelete(): void {
  revalidateTag("reports", EXPIRE_NOW);
  revalidateTag("gallery-results", EXPIRE_NOW);
  revalidateTag("images-stats", EXPIRE_NOW);
  revalidateTag("species-index", EXPIRE_NOW);
}
