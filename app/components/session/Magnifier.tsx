"use client";
import { useEffect, useRef, useState } from "react";
import type { Image } from "@/db/schema";
import type { MagnifierSize } from "@/app/components/session/SessionActionBar";
import { T } from "@/lib/tokens";

interface Props {
  image: Image;
  size: MagnifierSize;
  bw: boolean;
}

const FACTOR: Record<Exclude<MagnifierSize, "off">, number> = {
  S: 8, M: 4, L: 3, XL: 2,
};
const ZOOM = 3;

export function Magnifier({ image, size, bw }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (size === "off") {
      setPos(null);
      return;
    }
    // pointermove covers both mouse (hover) and touch (drag). For touch the
    // loupe tracks the finger while it's down and freezes at last position
    // when it lifts — workable UX on tablets.
    const onMove = (e: PointerEvent) => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setPos({ x: e.clientX, y: e.clientY });
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [size]);

  if (size === "off" || !pos) return null;

  const aspect = image.height && image.width ? image.height / image.width : 1;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 720;

  // The underlying <img> is rendered with object-fit: contain inside the
  // viewport — so it's letterboxed. The loupe must sample from the rendered
  // image rect, not the raw viewport, or it will magnify empty letterbox space.
  const imgAspect = image.width && image.height ? image.width / image.height : 1;
  const viewAspect = vw / vh;
  let renderedW: number;
  let renderedH: number;
  if (imgAspect > viewAspect) {
    renderedW = vw;
    renderedH = vw / imgAspect;
  } else {
    renderedH = vh;
    renderedW = vh * imgAspect;
  }
  const offsetX = (vw - renderedW) / 2;
  const offsetY = (vh - renderedH) / 2;

  // Loupe size: viewport-area fraction, aspect-locked to the image.
  const loupeArea = (vw * vh) / FACTOR[size];
  const loupeW = Math.sqrt(loupeArea / aspect);
  const loupeH = loupeW * aspect;

  // Map cursor (viewport coords) into image-rect coords.
  const cursorInImageX = pos.x - offsetX;
  const cursorInImageY = pos.y - offsetY;

  const filename = image.filename.replace(/^images\//, "");
  return (
    <div
      style={{
        position: "fixed",
        // Lock to a square so the circle isn't an ellipse when aspect != 1
        left: pos.x - Math.max(loupeW, loupeH) / 2,
        top: pos.y - Math.max(loupeW, loupeH) / 2,
        width: Math.max(loupeW, loupeH),
        height: Math.max(loupeW, loupeH),
        borderRadius: "50%",
        border: `3px solid ${T.accentPink}`,
        boxShadow: T.shadowMagnifier,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 40,
        backgroundImage: `url(/api/img/${filename})`,
        backgroundRepeat: "no-repeat",
        backgroundColor: T.surface0,
        backgroundSize: `${renderedW * ZOOM}px ${renderedH * ZOOM}px`,
        backgroundPosition: `${-(cursorInImageX * ZOOM - Math.max(loupeW, loupeH) / 2)}px ${-(cursorInImageY * ZOOM - Math.max(loupeW, loupeH) / 2)}px`,
        filter: bw ? "grayscale(1) contrast(1.05)" : "none",
      }}
    />
  );
}
