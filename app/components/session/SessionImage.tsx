"use client";
import NextImage from "next/image";
import type { Image } from "@/db/schema";
import { SOURCE_INFO_CHIP_ID } from "./SourceInfoChip";

interface Props {
  image: Image;
  bw: boolean;
  zoom: number;
  pan: { x: number; y: number };
  // SourceInfoChip is animated to opacity:0 / pointer-events:none when chrome
  // is hidden. Keeping aria-describedby pointed at it in that state forces
  // AT users to hear stale attribution metadata for an invisible element on
  // every focus event. Drop the reference when the chip isn't visible.
  chromeVisible: boolean;
}

export function SessionImage({ image, bw, zoom, pan, chromeVisible }: Props) {
  const filename = image.filename.replace(/^images\//, "");
  // next/image needs the intrinsic dimensions for CLS protection; with
  // object-fit:cover the rendered size is dictated by the container.
  // Fall back to a 4:3 sentinel if a legacy row lacks dimensions.
  const w = image.width ?? 1600;
  const h = image.height ?? 1200;
  return (
    <div className="session-image-frame">
      <NextImage
        key={image.imageId}
        src={`/api/img/${filename}`}
        alt={image.commonName || image.taxonSpecies || (image.taxonOrder ? `${image.taxonOrder} specimen` : "specimen")}
        aria-describedby={chromeVisible ? SOURCE_INFO_CHIP_ID : undefined}
        width={w}
        height={h}
        priority
        draggable={false}
        style={{
          // R8 (2026-05-16): switched contain → cover per user direction.
          // Maximizes drawing canvas area at the cost of cropping edges.
          // Magnifier handles seeing detail in the clipped regions; users
          // skip to the next image if a crop ate the subject.
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: bw ? "grayscale(1) contrast(1.05)" : "none",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      />
    </div>
  );
}
