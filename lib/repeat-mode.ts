import type { Image } from "@/db/schema";

export type RepeatMode = "default" | "never-repeat-animals" | "allow-different-angles";

export function applyRepeatMode(items: Image[], mode: RepeatMode): Image[] {
  if (mode === "default") return items;

  if (mode === "never-repeat-animals") {
    const seen = new Set<string>();
    const out: Image[] = [];
    for (const it of items) {
      const key = it.taxonSpecies || it.commonName || it.imageId;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
    return out;
  }

  // allow-different-angles: at most ONE collection per species; all images from that collection are kept
  const seenSpecies = new Set<string>();
  const seenCollections = new Set<string>();
  const out: Image[] = [];
  for (const it of items) {
    const speciesKey = it.taxonSpecies || it.commonName || it.imageId;
    // Defensive: collectionId is currently notNull in the schema, but if the
    // type ever loosens (or a row is malformed) every nulled item would
    // collapse into a single "null" bucket and only the first would survive.
    // Treat null/missing collection as "unique image, always keep" — that
    // matches the user-visible intent of "allow different angles".
    if (it.collectionId == null) {
      out.push(it);
      continue;
    }
    if (seenCollections.has(it.collectionId)) {
      out.push(it);
      continue;
    }
    if (seenSpecies.has(speciesKey)) continue;
    seenSpecies.add(speciesKey);
    seenCollections.add(it.collectionId);
    out.push(it);
  }
  return out;
}
