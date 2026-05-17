"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SketchfabHit, SketchfabSearchResponse } from "@/lib/sketchfab/types";
import { sketchfabQueryKey } from "@/lib/sketchfab/query-keys";

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

export { sketchfabQueryKey } from "@/lib/sketchfab/query-keys";

/** Match the CSS exit animation duration (--timing-base = 0.15s). Kept in
 *  sync manually since CSS custom props can't be read reliably at module load. */
const EXIT_ANIMATION_MS = 150;

/** Skeleton count: 6 = LCM(1,2,3) so every breakpoint shows complete rows.
 *  At 3 cols → 2 rows; at 2 cols → 3 rows. */
const SKELETON_COUNT = 6;

type RenderState = "closed" | "open" | "closing";

export function SketchfabBrowsePanel({ scientific, common, open, onClose }: Props) {
  // Internal state machine: `closing` keeps the DOM mounted briefly so the
  // exit animation can play. `closed` unmounts. Initial state mirrors `open`
  // so the "open=false from mount" case (no DOM, no fetch) still holds.
  const [renderState, setRenderState] = useState<RenderState>(open ? "open" : "closed");

  useEffect(() => {
    if (open) {
      setRenderState("open");
      return;
    }
    // Only animate-out if we were actually open; if we were already closed,
    // stay closed (avoids a phantom closing frame on initial mount).
    setRenderState((prev) => (prev === "open" ? "closing" : "closed"));
    const t = setTimeout(() => setRenderState("closed"), EXIT_ANIMATION_MS);
    return () => clearTimeout(t);
  }, [open]);

  // Escape closes the panel. Stop bubble so it doesn't escape to
  // SessionPlayer's window-level handler (which would push to "/").
  // (Click-outside removed in /audit 2026-05-17 — closes via Escape, the
  //  close button, or the action-bar Sketchfab toggle. Stops accidental
  //  dismissal when the student touches the canvas to look at the photo.)
  useEffect(() => {
    if (renderState !== "open") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [renderState, onClose]);

  const { data, isPending, isError } = useQuery({
    queryKey: sketchfabQueryKey(scientific, common),
    queryFn: ({ signal }) => fetchSketchfab(scientific, common, signal),
    enabled: open && !!scientific && !!common,
    staleTime: 10 * 60_000,
    gcTime: 20 * 60_000,
  });

  if (renderState === "closed") return null;

  const manualSearchUrl =
    `https://sketchfab.com/search?type=models&q=${encodeURIComponent(common || scientific)}`;

  return (
    <div
      className="sketchfab-panel u-backdrop-blur-md"
      data-state={renderState}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sketchfab-panel-title"
    >
      <header className="sketchfab-panel-header">
        <span className="sketchfab-panel-title" id="sketchfab-panel-title">
          Sketchfab models
        </span>
        <button
          type="button"
          className="sketchfab-panel-close"
          aria-label="Close Sketchfab panel"
          onClick={onClose}
        >✕</button>
      </header>

      {isPending && (
        <ul className="sketchfab-panel-grid" aria-busy="true">
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <li key={i} className="sketchfab-card-skeleton" data-testid="sketchfab-skeleton">
              <div className="sketchfab-card-skeleton-thumb" />
              <div className="sketchfab-card-skeleton-line sketchfab-card-skeleton-line-title-1" />
              <div className="sketchfab-card-skeleton-line sketchfab-card-skeleton-line-title-2" />
              <div className="sketchfab-card-skeleton-line sketchfab-card-skeleton-line-author" />
            </li>
          ))}
        </ul>
      )}

      {!isPending && isError && (
        <div className="sketchfab-panel-empty is-error" role="alert">
          <span className="sketchfab-panel-empty-glyph" aria-hidden="true">⚠</span>
          <p>Couldn't reach Sketchfab right now.</p>
          <a className="sketchfab-empty-link" href={manualSearchUrl} target="_blank" rel="noopener noreferrer">
            Search Sketchfab in a new tab ↗
          </a>
        </div>
      )}

      {!isPending && !isError && data && data.hits.length === 0 && (
        <div className="sketchfab-panel-empty">
          <span className="sketchfab-panel-empty-glyph" aria-hidden="true">◌</span>
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
                <span className="sketchfab-card-meta">
                  <span className="sketchfab-card-author">@{h.authorUsername}</span>
                  {h.licenseSlug && (
                    <span
                      className="sketchfab-card-license"
                      aria-label={`License: ${h.licenseSlug.toUpperCase()}`}
                    >{h.licenseSlug}</span>
                  )}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <footer className="sketchfab-panel-source-footer">Models from Sketchfab</footer>
    </div>
  );
}

/** Lightweight precheck: hits the same endpoint as the panel but reads only
 *  precachedHasModels. Cached identically (same sketchfabQueryKey) so when
 *  the panel opens it reuses the cached result rather than re-fetching. */
export function useSketchfabAvailability(scientific: string, common: string) {
  const { data } = useQuery({
    queryKey: sketchfabQueryKey(scientific, common),
    queryFn: ({ signal }) => fetchSketchfab(scientific, common, signal),
    enabled: !!scientific && !!common,
    staleTime: 10 * 60_000,
    gcTime: 20 * 60_000,
  });
  // Tri-state: undefined (loading) | true (has hits or unchecked) | false (precache says none)
  if (!data) return undefined;
  if (data.hits.length > 0) return true;
  // If precachedHasModels is explicitly false, no models. Otherwise treat as unknown.
  return data.precachedHasModels !== false;
}
