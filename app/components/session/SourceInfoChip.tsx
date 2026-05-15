"use client";
import { T } from "@/lib/tokens";
import type { Image } from "@/db/schema";

const ORDER_COLORS: Record<string, string> = {
  Coleoptera: "#FF6EC7", Lepidoptera: "#F8B4D9", Hymenoptera: "#FFD166",
  Hemiptera: "#E16AAA", Diptera: "#A78BFA", Odonata: "#67D4E6",
  Orthoptera: "#A8E6A1", Mantodea: "#7FD89A", Neuroptera: "#D4C5F9",
  Blattodea: "#9C8AAC", Dermaptera: "#C9A8D4", Phasmatodea: "#B8D898",
  Trichoptera: "#E8A8D4", Ephemeroptera: "#F0D796", Plecoptera: "#88B8D4",
  Isoptera: "#A89684",
};

interface Props {
  image: Image;
  visible: boolean;
}

export function SourceInfoChip({ image, visible }: Props) {
  const orderColor = (image.taxonOrder && ORDER_COLORS[image.taxonOrder]) || "#B8B0C4";
  const name = image.commonName || image.taxonSpecies || image.imageId;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 90,
        right: T.s8,
        maxWidth: 320,
        background: T.surfaceChipStrong,
        backdropFilter: T.blurSm,
        WebkitBackdropFilter: T.blurSm,
        border: `1px solid ${T.borderSubtle}`,
        borderRadius: T.r2xl,
        padding: `${T.s4}px ${T.s5}px`,
        display: "flex",
        gap: T.s4,
        alignItems: "flex-start",
        opacity: visible ? 1 : 0,
        transform: `translateY(${visible ? 0 : -4}px)`,
        transition: `opacity ${T.timingBase}, transform ${T.timingBase}`,
        pointerEvents: visible ? "auto" : "none",
        zIndex: 25,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          marginTop: 6,
          background: orderColor,
          boxShadow: `0 0 8px ${orderColor}`,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontFamily: "var(--font-display), serif", fontWeight: 500, fontSize: T.textLg }}>
          {name}
        </div>
        {image.taxonSpecies && image.commonName && (
          <div style={{ color: T.textTertiary, fontSize: T.textXs, fontStyle: "italic" }}>
            {image.taxonSpecies}
            {image.taxonOrder ? ` · ${image.taxonOrder}` : null}
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
    </div>
  );
}
