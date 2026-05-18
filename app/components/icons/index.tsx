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

// Phase F (2026-05-18) — gallery icon. Tried ladybug + hibiscus (both
// Fluent Color); both clashed against pink/lilac theme at small sizes.
// Switched to a monochrome pink cherry-blossom outline, inline SVG so
// it inherits color from currentColor (we tint with --accent-pink).
// Same shape family as the hero cherry blossom; quieter for a page
// header. Doesn't compete with the tile grid below it.
export function GalleryIcon({ size = 20, style, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      style={{ display: "inline-block", flexShrink: 0, verticalAlign: "middle", color: "var(--accent-pink)", ...style }}
      {...(rest as React.SVGAttributes<SVGSVGElement>)}
    >
      <g transform="translate(12 12)">
        <ellipse cx="0" cy="-5.5" rx="2.6" ry="3.8" />
        <ellipse cx="0" cy="-5.5" rx="2.6" ry="3.8" transform="rotate(72)" />
        <ellipse cx="0" cy="-5.5" rx="2.6" ry="3.8" transform="rotate(144)" />
        <ellipse cx="0" cy="-5.5" rx="2.6" ry="3.8" transform="rotate(216)" />
        <ellipse cx="0" cy="-5.5" rx="2.6" ry="3.8" transform="rotate(288)" />
        <circle cx="0" cy="0" r="2" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}

// Deprecated — kept exporting temporarily so callers can migrate; remove
// in a follow-up commit once HomeClient + GalleryGrid stop importing them.
export const CuteButterfly = makeIcon("butterfly.svg", "butterfly");
export const CuteClock = makeIcon("alarm_clock.svg", "alarm clock");
export const CuteRefresh = makeIcon("counterclockwise_arrows_button.svg", "refresh");
export const CuteBug = CuteLadybug;       // backwards-compat alias
export const SadBug = WiltedFlower;       // backwards-compat alias
