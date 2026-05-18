"use client";
import type { Image } from "@/db/schema";
import { OrderBadge } from "@/app/components/ui/OrderBadge";
import { TileMetaChips } from "@/app/components/gallery/TileMetaChips";

// Stable id shared with <SessionImage aria-describedby> so screen readers
// hear attribution as part of the image's accessible description in one read.
export const SOURCE_INFO_CHIP_ID = "session-source-info";

function sourceName(source: string): string {
  if (source === "inaturalist") return "iNaturalist";
  if (source === "bugwood") return "Bugwood";
  return source;
}

interface Props {
  image: Image;
  visible: boolean;
}

/**
 * Phase F (2026-05-17) — chip layout mirrors the gallery tile so the
 * student sees the same axes in the same order whether they're browsing
 * or drawing. From top down:
 *   1. taxon-order badge       (OrderBadge — same as gallery meta-row)
 *   2. license code            (same pill style as gallery)
 *   3. life stage / sex / institution chips (TileMetaChips — same)
 *   4. scientific name
 *   5. source name (iNaturalist / Bugwood)
 *   6. photographer attribution
 */
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
      <div className="session-source-chip-meta-row">
        <OrderBadge order={image.taxonOrder} />
        {image.license && (
          <span
            className="grid-item-license"
            aria-label={`license ${image.license}`}
          >
            {image.license}
          </span>
        )}
      </div>
      <TileMetaChips
        lifeStage={image.lifeStage}
        sex={image.sex}
        institution={image.institution}
      />
      {image.taxonSpecies && (
        <div className="session-source-chip-line session-source-chip-line-species">
          {image.taxonSpecies}
        </div>
      )}
      {image.source && (
        <div className="session-source-chip-line">{sourceName(image.source)}</div>
      )}
      {image.photographer && (
        <div className="session-source-chip-line">{image.photographer}</div>
      )}
    </div>
  );
}
