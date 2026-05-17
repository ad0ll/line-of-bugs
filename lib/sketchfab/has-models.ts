// lib/sketchfab/has-models.ts
import { db } from "@/db";
import { speciesMetadata } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Returns the pre-cached "does Sketchfab have models for this species" flag.
 *   - true   → at least one relevant model existed at last check
 *   - false  → checked, none found
 *   - null   → never checked (caller should treat as "unknown" / fetch live)
 */
export function hasSketchfabModels(taxonSpecies: string): boolean | null {
  const row = db.select({
    has: speciesMetadata.hasSketchfabModels,
  })
    .from(speciesMetadata)
    .where(eq(speciesMetadata.taxonSpecies, taxonSpecies))
    .get();
  if (!row) return null;
  return row.has === null ? null : row.has;
}
