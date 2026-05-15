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
