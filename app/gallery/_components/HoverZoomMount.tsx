'use client';

import { useEffect, useRef, useState } from 'react';
import { HoverZoom } from './HoverZoom';

// GalleryGrid is rendered inside a <Suspense>; the #gallery-grid element doesn't
// exist on first paint. Watch the DOM until it streams in, then mount HoverZoom.
export function HoverZoomMount() {
  const ref = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
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
  }, []);

  if (!ready) return null;
  return <HoverZoom itemSelector=".grid-item" gridRef={ref} delay={250} />;
}
