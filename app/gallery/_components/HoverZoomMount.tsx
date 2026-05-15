'use client';

import { useEffect, useRef, useState } from 'react';
import { HoverZoom } from './HoverZoom';

// GalleryGrid is rendered inside a <Suspense>; the #gallery-grid element doesn't
// exist on first paint. Watch the DOM until it streams in, then mount HoverZoom.
//
// HoverZoom is mouseover-driven and has no equivalent touch affordance — tapping
// a tile already opens the source image in a new tab, which is what touch users
// want anyway. Skip the popup entirely on coarse-pointer devices so we don't
// waste cycles wiring up listeners that can never fire.
export function HoverZoomMount() {
  const ref = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    setCoarsePointer(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setCoarsePointer(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (coarsePointer) return;
    const existing = document.getElementById('gallery-grid');
    if (existing) {
      ref.current = existing;
      setReady(true);
      return;
    }
    const observer = new MutationObserver(() => {
      const grid = document.getElementById('gallery-grid');
      if (grid) {
        ref.current = grid;
        setReady(true);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [coarsePointer]);

  if (coarsePointer || !ready) return null;
  return <HoverZoom itemSelector=".grid-item" gridRef={ref} delay={250} />;
}
