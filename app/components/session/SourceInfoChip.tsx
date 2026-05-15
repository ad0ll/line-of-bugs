"use client";
import type { Image } from "@/db/schema";
import { OrderBadge } from "@/app/components/ui/OrderBadge";

// Stable id shared with <SessionImage aria-describedby> so screen readers
// hear attribution as part of the image's accessible description in one read.
export const SOURCE_INFO_CHIP_ID = "session-source-info";

interface Props {
  image: Image;
  visible: boolean;
}

export function SourceInfoChip({ image, visible }: Props) {
  return (
    <div
      id={SOURCE_INFO_CHIP_ID}
      className="session-source-chip"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateY(${visible ? 0 : -4}px)`,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <OrderBadge order={image.taxonOrder} />
      {image.taxonSpecies && (
        <div className="session-source-chip-line session-source-chip-line-species">
          {image.taxonSpecies}
        </div>
      )}
      {image.photographer && (
        <div className="session-source-chip-line">{image.photographer}</div>
      )}
      {image.institution && (
        <div className="session-source-chip-line">{image.institution}</div>
      )}
    </div>
  );
}
