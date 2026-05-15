'use client';

import { useEffect, useRef } from 'react';

function mediumUrl(imagePath: string): string {
  const name = imagePath.split('/').pop() ?? imagePath;
  return `/api/medium/${name}`;
}

export interface HoverZoomProps {
  itemSelector: string;
  gridRef: React.RefObject<HTMLElement | null>;
  delay: number;
}

export function HoverZoom({ itemSelector, gridRef, delay }: HoverZoomProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    function show(imagePath: string, anchor: HTMLElement) {
      const popup = popupRef.current;
      const img = imgRef.current;
      if (!popup || !img) return;
      img.src = mediumUrl(imagePath);
      const rect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rightSpace = vw - rect.right - 8;
      const leftSpace = rect.left - 8;
      const maxW = Math.min(1024, Math.max(rightSpace, leftSpace, 200));
      popup.style.maxWidth = maxW + 'px';
      img.style.maxWidth = maxW + 'px';
      let left = rect.right + 8;
      if (left + maxW > vw) left = rect.left - maxW - 8;
      left = Math.max(4, Math.min(left, vw - maxW - 4));
      popup.style.left = left + 'px';
      let top = rect.top;
      const maxH = vh * 0.9;
      if (top + maxH > vh) top = Math.max(0, vh - maxH);
      popup.style.top = top + 'px';
      popup.classList.add('visible');
    }

    function hide() {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const popup = popupRef.current;
      const img = imgRef.current;
      if (popup) popup.classList.remove('visible');
      if (img) img.src = '';
    }

    let currentHoverId: string | null = null;

    function onOver(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const item = target.closest<HTMLElement>(itemSelector);
      const id = item?.dataset.id ?? null;
      const isOverThumb = !!target.closest('.grid-item-image');
      if (!isOverThumb) {
        if (currentHoverId) {
          currentHoverId = null;
          hide();
        }
        return;
      }
      if (id === currentHoverId) return;
      currentHoverId = id;
      if (!item || !id) {
        hide();
        return;
      }
      hide();
      const imgPath = item.dataset.imagePath;
      if (imgPath) {
        timerRef.current = setTimeout(() => show(imgPath, item), delay);
      }
    }

    function onOut(e: MouseEvent) {
      const related = (e.relatedTarget as HTMLElement | null)?.closest<HTMLElement>(itemSelector);
      if (!related || related.dataset.id !== currentHoverId) {
        currentHoverId = null;
        hide();
      }
    }

    grid.addEventListener('mouseover', onOver);
    grid.addEventListener('mouseout', onOut);
    return () => {
      grid.removeEventListener('mouseover', onOver);
      grid.removeEventListener('mouseout', onOut);
      hide();
    };
  }, [gridRef, itemSelector, delay]);

  return (
    <div className="hover-zoom-popup" ref={popupRef} aria-hidden="true">
      <img ref={imgRef} alt="" />
    </div>
  );
}
