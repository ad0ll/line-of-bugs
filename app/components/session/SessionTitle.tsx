"use client";
import type { Image } from "@/db/schema";

interface Props {
  image: Image;
}

export function SessionTitle({ image }: Props) {
  const primary = image.commonName || image.taxonSpecies || image.imageId;
  const hasBoth = !!image.commonName && !!image.taxonSpecies;
  return (
    <div className="session-title-chip">
      <span className="session-title-primary">{primary}</span>
      {hasBoth && <span className="session-title-secondary">{image.taxonSpecies}</span>}
    </div>
  );
}
