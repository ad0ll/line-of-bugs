import { updateTag } from "next/cache";

// All four helpers are invoked exclusively from server actions, so we use
// updateTag — Next 16's read-your-own-writes variant. updateTag immediately
// expires the cached data with no stale-while-revalidate window, so the
// admin / reporter sees the result of their action on the very next request.
// Use revalidateTag(tag, profile) only from non-action contexts (route
// handlers, webhooks) where SWR is acceptable.

export function invalidateOnReportSubmit(): void {
  updateTag("reports");
  updateTag("gallery-results");
  updateTag("images-stats");
}

export function invalidateOnDismiss(): void {
  updateTag("reports");
  updateTag("gallery-results");
}

export function invalidateOnHide(): void {
  updateTag("reports");
  updateTag("gallery-results");
  updateTag("images-stats");
}

export function invalidateOnDelete(): void {
  updateTag("reports");
  updateTag("gallery-results");
  updateTag("images-stats");
  updateTag("species-index");
}
