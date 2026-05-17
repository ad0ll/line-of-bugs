"use client";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SketchfabHit, SketchfabSearchResponse } from "@/lib/sketchfab/types";

interface Props {
  scientific: string;
  common: string;
  open: boolean;
  onClose: () => void;
}

export async function fetchSketchfab(
  scientific: string,
  common: string,
  signal: AbortSignal,
): Promise<SketchfabSearchResponse> {
  const u = new URL("/api/sketchfab/search", window.location.origin);
  u.searchParams.set("scientific", scientific);
  u.searchParams.set("common", common);
  const r = await fetch(u.toString(), { signal });
  if (!r.ok) throw new Error(`sketchfab search failed: ${r.status}`);
  return r.json();
}

export function sketchfabQueryKey(scientific: string, common: string) {
  return ["sketchfab", scientific, common] as const;
}

export function SketchfabBrowsePanel({ scientific, common, open, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Escape + outside-click dismiss
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose]);

  const { data, isPending, isError } = useQuery({
    queryKey: sketchfabQueryKey(scientific, common),
    queryFn: ({ signal }) => fetchSketchfab(scientific, common, signal),
    enabled: open && !!scientific && !!common,
    staleTime: 10 * 60_000,
  });

  if (!open) return null;

  const manualSearchUrl =
    `https://sketchfab.com/search?type=models&q=${encodeURIComponent(common || scientific)}`;

  return (
    <div ref={ref} className="sketchfab-panel u-backdrop-blur-md" role="dialog" aria-label="Sketchfab models">
      <header className="sketchfab-panel-header">
        <span className="sketchfab-panel-title">Sketchfab models</span>
        <button
          type="button"
          className="sketchfab-panel-close"
          aria-label="Close Sketchfab panel"
          onClick={onClose}
        >×</button>
      </header>

      {isPending && (
        <div className="sketchfab-panel-grid" aria-busy="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="sketchfab-card-skeleton" data-testid="sketchfab-skeleton" />
          ))}
        </div>
      )}

      {!isPending && isError && (
        <div className="sketchfab-panel-empty">
          <p>Couldn't reach Sketchfab right now.</p>
          <a className="sketchfab-empty-link" href={manualSearchUrl} target="_blank" rel="noopener noreferrer">
            Search Sketchfab in a new tab ↗
          </a>
        </div>
      )}

      {!isPending && !isError && data && data.hits.length === 0 && (
        <div className="sketchfab-panel-empty">
          <p>No 3D models found for this species.</p>
          <a className="sketchfab-empty-link" href={manualSearchUrl} target="_blank" rel="noopener noreferrer">
            Search Sketchfab anyway ↗
          </a>
        </div>
      )}

      {!isPending && !isError && data && data.hits.length > 0 && (
        <ul className="sketchfab-panel-grid">
          {data.hits.map((h: SketchfabHit) => (
            <li key={h.uid} className="sketchfab-card">
              <a
                className="sketchfab-card-link"
                href={h.viewerUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  className="sketchfab-card-thumb"
                  src={h.thumbnailUrl}
                  alt={h.name}
                  width={256}
                  height={144}
                  loading="lazy"
                  decoding="async"
                />
                <span className="sketchfab-card-title">{h.name}</span>
                <span
                  className="sketchfab-card-author"
                  title={h.licenseSlug ? `License: ${h.licenseSlug.toUpperCase()}` : undefined}
                >@{h.authorUsername}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <footer className="sketchfab-panel-source-footer">Models from Sketchfab</footer>
    </div>
  );
}
