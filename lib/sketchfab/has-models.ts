// lib/sketchfab/has-models.ts
//
// Thin compatibility shim around getSpeciesCache. Kept so existing callers
// (and the useSketchfabAvailability hook) don't need to know about the
// full cache shape. Prefer importing getSpeciesCache directly for new code
// that needs the actual hits array.
import { getSpeciesCache } from "./cache";

/**
 * Returns the pre-cached "does Sketchfab have models for this species" flag.
 *   - true   → at least one relevant model existed at last check
 *   - false  → checked, none found
 *   - null   → never checked (caller should treat as "unknown" / fetch live)
 */
export function hasSketchfabModels(taxonSpecies: string): boolean | null {
  const cache = getSpeciesCache(taxonSpecies);
  if (!cache) return null;
  return cache.hasModels;
}
