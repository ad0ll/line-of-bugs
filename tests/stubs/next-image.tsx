// Plain <img> stub for next/image, used only in the vitest browser harness.
// The real next/image module reads `process.env` at top level and crashes in
// the browser. Aliased via vitest.config.ts -> tests/stubs/next-image.tsx.
import type { ImgHTMLAttributes } from "react";

interface ImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  loading?: "lazy" | "eager";
}

export default function NextImageStub({
  fill: _fill,
  sizes: _sizes,
  priority: _priority,
  ...rest
}: ImageProps) {
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  return <img {...rest} />;
}

export function getImageProps() {
  return { props: {} };
}
