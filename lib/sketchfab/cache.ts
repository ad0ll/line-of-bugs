// lib/sketchfab/cache.ts
//
// Reader for the species_metadata precache. Used by the search route to
// avoid live Sketchfab calls — prod's Hetzner egress IP is bot-blocked by
// Akamai, so a remote enrichment job (Windmill) is the only thing that
// talks to Sketchfab. This module is the route's window into what that
// job has populated.
import { db } from "@/db";
import { speciesMetadata } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { SketchfabHit } from "./types";

export interface SketchfabCache {
  /** true = job confirmed ≥1 model. false = job confirmed none. null = unchecked. */
  hasModels: boolean | null;
  /** Trimmed hit array. Empty when hasModels is false; empty when no job has run. */
  hits: SketchfabHit[];
  /** When the cache row was last written by the enrichment job. */
  lastCheckedAt: Date | null;
}

/**
 * Reads the cache for one species.
 *
 * Returns `null` when no row exists for the species (never enriched).
 * Returns a SketchfabCache when the row exists, even if all fields are null/empty.
 *
 * JSON.parse failures (malformed cache row) are logged and treated as
 * "no cached hits" so the route can degrade gracefully rather than 500.
 */
export function getSpeciesCache(taxonSpecies: string): SketchfabCache | null {
  const row = db
    .select({
      hasModels: speciesMetadata.hasSketchfabModels,
      hitsJson: speciesMetadata.sketchfabHitsJson,
      lastCheckedAt: speciesMetadata.sketchfabLastCheckedAt,
    })
    .from(speciesMetadata)
    .where(eq(speciesMetadata.taxonSpecies, taxonSpecies))
    .get();
  if (!row) return null;

  let hits: SketchfabHit[] = [];
  if (row.hitsJson) {
    try {
      const parsed = JSON.parse(row.hitsJson);
      if (Array.isArray(parsed)) hits = parsed as SketchfabHit[];
    } catch (e) {
      // Corrupt cache row — log and degrade to empty. The next enrichment
      // run will overwrite it. Don't crash the route handler.
      console.warn(
        `[sketchfab/cache] malformed hits JSON for ${taxonSpecies}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return {
    hasModels: row.hasModels === null ? null : row.hasModels,
    hits,
    lastCheckedAt: row.lastCheckedAt,
  };
}
