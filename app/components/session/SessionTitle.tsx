"use client";
import type { Image } from "@/db/schema";
import { titleCaseCommonName } from "@/lib/text-format";

interface Props {
  image: Image;
}

export function SessionTitle({ image }: Props) {
  // Common names get title-cased ("monarch butterfly" → "Monarch
  // Butterfly"). Scientific names stay as stored — Linnaean
  // convention requires genus capitalized + species epithet lowercase.
  const commonName = titleCaseCommonName(image.commonName);
  const primary = commonName || image.taxonSpecies || image.imageId;
  const hasBoth = !!commonName && !!image.taxonSpecies;
  return (
    <div className="session-title-chip">
      <span className="session-title-primary">{primary}</span>
      {hasBoth && <span className="session-title-secondary">{image.taxonSpecies}</span>}
    </div>
  );
}
