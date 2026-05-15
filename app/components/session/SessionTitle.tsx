"use client";
import type { Image } from "@/db/schema";

interface Props {
  image: Image;
}

export function SessionTitle({ image }: Props) {
  const name = image.commonName || image.taxonSpecies || image.imageId;
  return <div className="session-title-chip">{name}</div>;
}
