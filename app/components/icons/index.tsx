// Icon components backed by Microsoft Fluent Emoji (MIT-licensed) SVG files
// served from /public/icons. We use full-color emoji icons here because:
//   1. The brand brief is "girly girl girl girl super cute" — flat hand-drawn
//      SVG fell flat at small sizes; emoji art is designed to read cute at
//      anywhere from 16px to 64px.
//   2. Static SVG files cache better than 150 KB of inlined SVG paths.
//   3. The Fluent Color style matches our pastel-on-dark identity well.
//
// Source: https://github.com/microsoft/fluentui-emoji (MIT © Microsoft).
// Each component keeps the same { size, className, ...rest } interface as the
// previous hand-drawn icons so callers don't change.

import type { ImgHTMLAttributes } from "react";

interface IconProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "width" | "height" | "src" | "alt"> {
  size?: number;
}

function makeIcon(file: string, _alt: string) {
  return function Icon({ size = 20, ...rest }: IconProps) {
    return (
      <img
        src={`/icons/${file}`}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        draggable={false}
        decoding="async"
        style={{ display: "inline-block", flexShrink: 0, verticalAlign: "middle", ...rest.style }}
        {...rest}
      />
    );
  };
}

export const CuteFlower = makeIcon("cherry_blossom.svg", "cherry blossom");
export const CuteLadybug = makeIcon("lady_beetle.svg", "ladybug");
export const WiltedFlower = makeIcon("wilted_flower.svg", "wilted flower");

// Phase F (2026-05-17) — gallery icon switched from the Fluent ladybug
// (red + black palette clashed with the pink/lilac theme) to Fluent
// hibiscus. Hibiscus shares the cherry-blossom's pink-with-yellow-center
// five-petal silhouette, so the title + gallery CTA read as a kindred
// brand pair.
export const GalleryIcon = makeIcon("hibiscus.svg", "hibiscus");

// Deprecated — kept exporting temporarily so callers can migrate; remove
// in a follow-up commit once HomeClient + GalleryGrid stop importing them.
export const CuteButterfly = makeIcon("butterfly.svg", "butterfly");
export const CuteClock = makeIcon("alarm_clock.svg", "alarm clock");
export const CuteRefresh = makeIcon("counterclockwise_arrows_button.svg", "refresh");
export const CuteBug = CuteLadybug;       // backwards-compat alias
export const SadBug = WiltedFlower;       // backwards-compat alias
