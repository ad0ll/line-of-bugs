import type { SVGProps } from "react";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  size?: number;
}

function svg(content: React.ReactNode, viewBox = "0 0 24 24") {
  return function Icon({ size = 20, ...rest }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        width={size}
        height={size}
        aria-hidden="true"
        fill="currentColor"
        {...rest}
      >
        {content}
      </svg>
    );
  };
}

// Soft 5-petal flower, slight asymmetry — matches existing flower SVG family.
export const CuteFlower = svg(
  <>
    <circle cx="12" cy="6" r="3" />
    <circle cx="18" cy="12" r="3" />
    <circle cx="12" cy="18" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="12" cy="12" r="2.5" fill="color-mix(in srgb, currentColor 65%, transparent)" />
  </>,
);

// Rounded butterfly silhouette
export const CuteButterfly = svg(
  <>
    <path d="M12 6c-2 -2 -5 -2 -7 0c-2 2 -2 5 0 7c1 1 2 1 3 1c-1 2 0 4 2 5c2 -1 3 -3 2 -5c1 0 2 0 3 -1c2 -2 2 -5 0 -7c-2 -2 -5 -2 -7 0z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="currentColor" fillOpacity="0.55" />
    <line x1="12" y1="7" x2="12" y2="19" stroke="currentColor" strokeWidth="1.2" />
  </>,
);

// Cute round clock
export const CuteClock = svg(
  <>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <circle cx="12" cy="4" r="1" />
  </>,
);

// Rounded ladybug (the friendly bug)
export const CuteBug = svg(
  <>
    <ellipse cx="12" cy="13" rx="7" ry="6" fill="currentColor" fillOpacity="0.7" />
    <path d="M12 7v12" stroke="var(--surface-0)" strokeWidth="1" />
    <circle cx="9" cy="11" r="0.8" fill="var(--surface-0)" />
    <circle cx="15" cy="11" r="0.8" fill="var(--surface-0)" />
    <circle cx="9" cy="14" r="0.8" fill="var(--surface-0)" />
    <circle cx="15" cy="14" r="0.8" fill="var(--surface-0)" />
    <path d="M9 6c-1 -2 1 -3 3 -3s4 1 3 3" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
  </>,
);

// Spinny-arrows, rounded
export const CuteRefresh = svg(
  <>
    <path d="M5 9a7 7 0 0 1 12 -2l2 -1v5h-5l2 -2a5 5 0 0 0 -9 1" fill="currentColor" />
    <path d="M19 15a7 7 0 0 1 -12 2l-2 1v-5h5l-2 2a5 5 0 0 0 9 -1" fill="currentColor" />
  </>,
);

// Sad-bug doodle for empty states
export const SadBug = svg(
  <>
    <ellipse cx="12" cy="14" rx="6" ry="5" fill="currentColor" fillOpacity="0.7" />
    <circle cx="10" cy="12" r="0.7" fill="var(--surface-0)" />
    <circle cx="14" cy="12" r="0.7" fill="var(--surface-0)" />
    <path d="M10 16c0.7 -0.7 3.3 -0.7 4 0" stroke="var(--surface-0)" strokeWidth="0.9" fill="none" strokeLinecap="round" />
    <path d="M9 8l-2 -2M15 8l2 -2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </>,
  "0 0 24 24",
);
