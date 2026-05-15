"use client";
import { T } from "@/lib/tokens";
import type { Image } from "@/db/schema";
import { OrderBadge } from "@/app/components/ui/OrderBadge";

interface Props {
  image: Image;
  visible: boolean;
}

export function SourceInfoChip({ image, visible }: Props) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: "var(--chrome-bottom-offset)",
        right: T.s8,
        maxWidth: 320,
        background: T.surfaceChipStrong,
        backdropFilter: T.blurSm,
        WebkitBackdropFilter: T.blurSm,
        border: `1px solid ${T.borderSubtle}`,
        borderRadius: T.r2xl,
        padding: `${T.s4}px ${T.s5}px`,
        display: "flex",
        flexDirection: "column",
        gap: T.s2,
        alignItems: "flex-start",
        opacity: visible ? 1 : 0,
        transform: `translateY(${visible ? 0 : -4}px)`,
        transition: `opacity ${T.timingBase}, transform ${T.timingBase}`,
        pointerEvents: visible ? "auto" : "none",
        zIndex: 25,
      }}
    >
      <OrderBadge order={image.taxonOrder} />
      {image.taxonSpecies && (
        <div style={{ color: T.textTertiary, fontSize: T.textXs, fontStyle: "italic" }}>
          {image.taxonSpecies}
        </div>
      )}
      {image.photographer && (
        <div style={{ color: T.textTertiary, fontSize: T.textXs }}>
          {image.photographer}
        </div>
      )}
      {image.institution && (
        <div style={{ color: T.textTertiary, fontSize: T.textXs }}>
          {image.institution}
        </div>
      )}
    </div>
  );
}
