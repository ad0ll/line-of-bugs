"use client";
import { useEffect, useRef, useState } from "react";
import type { Image } from "@/db/schema";
import type { MagnifierSize } from "@/app/components/session/SessionActionBar";

interface Props {
  image: Image;
  size: MagnifierSize;
  bw: boolean;
}

const FACTOR: Record<Exclude<MagnifierSize, "off">, number> = {
  S: 8, M: 4, L: 3, XL: 2,
};
const ZOOM_BASE = 3;
// Click / right-click on the loupe expand the loupe area 2×. Phase E
// (2026-05-17): left-click was added because Mac trackpad's natural
// one-finger tap registers as a left-click and users expected "tap = bigger
// view". Esc still closes via the SessionPlayer keyboard handler cycling
// the magnifier size to "off".
const EXPAND_MULTIPLIER = 2;

export function Magnifier({ image, size, bw }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // Whether the user has expanded the loupe via right-click. Resets on
  // each toggle (size cycle). Also drives the "first-time hint" pill —
  // shown until the user has either expanded once OR moved the cursor
  // a healthy distance, indicating they've figured out the affordance.
  const [expanded, setExpanded] = useState(false);
  const [showHint, setShowHint] = useState(false);
  // Viewport dims tracked via state + resize listener. Reading window.innerWidth
  // directly during render skips React's update cycle, so a window resize while
  // the loupe is active would leave the rendered-image rect stale until the next
  // pointermove and the magnifier would sample the wrong region of the image.
  const [viewport, setViewport] = useState<{ vw: number; vh: number }>({
    vw: 1280,
    vh: 720,
  });
  const rafRef = useRef<number | null>(null);
  // RAF callbacks can fire after cleanup cancels them if the browser has
  // already dispatched the frame (cancelAnimationFrame is racey with the
  // tick boundary). A late setPos on an unmounted component, or after the
  // size dep changed, would log a React warning and waste work; gate on
  // mountedRef to make the callback a no-op after teardown.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () =>
      setViewport({ vw: window.innerWidth, vh: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (size === "off") {
      setPos(null);
      setExpanded(false);
      setShowHint(false);
      return;
    }
    // pointermove covers both mouse (hover) and touch (drag). For touch the
    // loupe tracks the finger while it's down and freezes at last position
    // when it lifts — workable UX on tablets.
    const onMove = (e: PointerEvent) => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        setPos({ x: e.clientX, y: e.clientY });
      });
    };
    // Right-click toggles the expand state. preventDefault keeps the
    // browser's context menu out of the way.
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setExpanded((v) => !v);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("contextmenu", onContextMenu);
    setShowHint(true);
    // Hint fades after 4 s of magnifier-on time so it doesn't linger
    // for users who already know the controls.
    const hintTimer = setTimeout(() => setShowHint(false), 4000);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("contextmenu", onContextMenu);
      clearTimeout(hintTimer);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [size]);

  if (size === "off" || !pos) return null;

  const aspect = image.height && image.width ? image.height / image.width : 1;
  const { vw, vh } = viewport;

  // The underlying <img> uses object-fit: cover — the image overflows the
  // viewport on the longer axis (no letterbox; opposite of contain). The
  // loupe must sample from that overflowing rect or it magnifies the wrong
  // image region. With cover the shorter axis matches the viewport and the
  // longer axis extends past it; offsets are NEGATIVE on that axis.
  const imgAspect = image.width && image.height ? image.width / image.height : 1;
  const viewAspect = vw / vh;
  let renderedW: number;
  let renderedH: number;
  if (imgAspect > viewAspect) {
    // image wider than viewport per height — height = vh, sides clipped
    renderedH = vh;
    renderedW = vh * imgAspect;
  } else {
    // image taller than viewport per width — width = vw, top/bottom clipped
    renderedW = vw;
    renderedH = vw / imgAspect;
  }
  const offsetX = (vw - renderedW) / 2;
  const offsetY = (vh - renderedH) / 2;

  // Loupe size: viewport-area fraction, aspect-locked to the image.
  // Right-click expands by the multiplier; clicking again contracts.
  const sizeMultiplier = expanded ? EXPAND_MULTIPLIER : 1;
  const loupeArea = ((vw * vh) / FACTOR[size]) * sizeMultiplier;
  const loupeW = Math.sqrt(loupeArea / aspect);
  const loupeH = loupeW * aspect;
  const ZOOM = ZOOM_BASE;

  // Map cursor (viewport coords) into image-rect coords.
  const cursorInImageX = pos.x - offsetX;
  const cursorInImageY = pos.y - offsetY;

  const filename = image.filename.replace(/^images\//, "");
  // Square hit area so the box reads as square (R8: was circular).
  const side = Math.max(loupeW, loupeH);
  // Tap/click on the loupe toggles expand. The loupe is normally
  // pointer-events: none so it doesn't intercept hover-tracking on the
  // underlying image; we flip it on here so the click reaches us. The
  // pointermove handler is window-level and still fires through.
  const onMagnifierClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setExpanded((v) => !v);
  };
  return (
    <>
      <div
        className="session-magnifier"
        style={{
          left: pos.x - side / 2,
          top: pos.y - side / 2,
          width: side,
          height: side,
          backgroundImage: `url(/api/img/${filename})`,
          backgroundSize: `${renderedW * ZOOM}px ${renderedH * ZOOM}px`,
          backgroundPosition: `${-(cursorInImageX * ZOOM - side / 2)}px ${-(cursorInImageY * ZOOM - side / 2)}px`,
          filter: bw ? "grayscale(1) contrast(1.05)" : "none",
          pointerEvents: "auto",
          cursor: "zoom-in",
        }}
        onClick={onMagnifierClick}
      />
      {showHint && (
        <div
          className="session-magnifier-hint"
          style={{
            // Anchor below the loupe; cap to viewport to avoid clipping.
            left: Math.max(8, Math.min(vw - 280, pos.x - 130)),
            top: Math.min(vh - 28, pos.y + side / 2 + 8),
          }}
          role="status"
          aria-live="polite"
        >
          esc: close · tap/click: expand
        </div>
      )}
    </>
  );
}
