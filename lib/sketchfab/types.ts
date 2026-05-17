/**
 * Trimmed shape returned by /api/sketchfab/search.
 * Only fields the panel UI consumes — keeps the wire payload small
 * and decouples the client from Sketchfab's full model record.
 */
export interface SketchfabHit {
  uid: string;
  name: string;
  author: string;          // user.displayName ?? user.username
  authorUsername: string;  // for the @handle chip
  thumbnailUrl: string;    // 256x144 tier
  viewerUrl: string;       // canonical Sketchfab page (click target)
  licenseSlug: string | null;
  matchedBy: "scientific" | "common" | "both";
}

export interface SketchfabSearchResponse {
  hits: SketchfabHit[];
  /** Set true if either query returned ≥1 hit BEFORE relevance filtering.
   *  Lets the UI distinguish "Sketchfab has nothing" from "we filtered everything out". */
  rawHadResults: boolean;
  /** Set by the API route from species_metadata. true/false reflect a prior
   *  precache run; null/undefined means "never checked" — UI should treat as
   *  "show button optimistically". Always present in route responses. */
  precachedHasModels?: boolean | null;
}
