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

function makeIcon(file: string, alt: string) {
  return function Icon({ size = 20, ...rest }: IconProps) {
    return (
      <img
        src={`/icons/${file}`}
        alt=""
        aria-label={alt}
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
export const CuteButterfly = makeIcon("butterfly.svg", "butterfly");
export const CuteClock = makeIcon("alarm_clock.svg", "alarm clock");
export const CuteBug = makeIcon("lady_beetle.svg", "lady beetle");
export const CuteRefresh = makeIcon("counterclockwise_arrows_button.svg", "refresh");
export const SadBug = makeIcon("pensive_face.svg", "pensive face");
