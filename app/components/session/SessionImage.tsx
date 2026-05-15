"use client";
import type { Image } from "@/db/schema";

interface Props {
  image: Image;
  bw: boolean;
  zoom: number;
  pan: { x: number; y: number };
}

export function SessionImage({ image, bw, zoom, pan }: Props) {
  const filename = image.filename.replace(/^images\//, "");
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <img
        key={image.imageId}
        src={`/api/img/${filename}`}
        alt={image.commonName || image.taxonSpecies || image.imageId}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          filter: bw ? "grayscale(1) contrast(1.05)" : "none",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "center center",
          transition: "filter 0.15s",
          userSelect: "none",
          pointerEvents: "none",
        }}
        draggable={false}
      />
    </div>
  );
}
