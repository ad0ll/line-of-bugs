"use client";
import NextImage from "next/image";
import type { Image } from "@/db/schema";
import { SOURCE_INFO_CHIP_ID } from "./SourceInfoChip";

interface Props {
  image: Image;
  bw: boolean;
  zoom: number;
  pan: { x: number; y: number };
}

export function SessionImage({ image, bw, zoom, pan }: Props) {
  const filename = image.filename.replace(/^images\//, "");
  // DB has width/height for every image; fall back to a sensible 4:3 if a
  // legacy row is missing dimensions. next/image needs them for CLS protection
  // (even with images.unoptimized=true).
  const w = image.width ?? 1600;
  const h = image.height ?? 1200;
  return (
    <div className="session-image-frame">
      <NextImage
        key={image.imageId}
        src={`/api/img/${filename}`}
        alt={image.commonName || image.taxonSpecies || (image.taxonOrder ? `${image.taxonOrder} specimen` : "specimen")}
        aria-describedby={SOURCE_INFO_CHIP_ID}
        width={w}
        height={h}
        priority
        draggable={false}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          width: "auto",
          height: "auto",
          objectFit: "contain",
          filter: bw ? "grayscale(1) contrast(1.05)" : "none",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      />
    </div>
  );
}
