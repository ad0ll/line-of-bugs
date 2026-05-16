"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { GalleryRow, SearchGalleryResult } from "@/lib/queries/gallery";
import type { SubjectType } from "@/lib/subject";
import { GridTile } from "./GridTile";

interface Props {
  initial: SearchGalleryResult;
  q: string[];
  subject: SubjectType;
  institutions: string[];
  views: string[];
  lifeStages: string[];
  sexes: string[];
  groups: string[];
  /** Stable fingerprint of the filter state. Used as the effect dep
   *  for resetting rows when the parent re-renders with new filters —
   *  prevents identity-based reset loops since `initial` is a new
   *  object on every render. */
  filterKey: string;
}

export function InfiniteScroller({
  initial, q, subject, institutions, views, lifeStages, sexes, groups, filterKey,
}: Props) {
  const [rows, setRows] = useState<GalleryRow[]>(initial.rows);
  const [page, setPage] = useState(initial.page);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  /** In-flight page fetch — aborted when the filter set changes so a
   *  stale page from the previous filter can't append to the new view. */
  const inflightRef = useRef<AbortController | null>(null);

  // Reset state when the filter fingerprint changes. Keyed on the
  // stable string rather than the `initial` object identity so React
  // doesn't re-run the effect on every parent render.
  useEffect(() => {
    inflightRef.current?.abort();
    inflightRef.current = null;
    setRows(initial.rows);
    setPage(initial.page);
    setHasMore(initial.hasMore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    const controller = new AbortController();
    inflightRef.current = controller;
    try {
      const next = page + 1;
      const params = new URLSearchParams();
      if (q.length > 0) params.set("q", q.join(","));
      if (subject !== "all") params.set("subject", subject);
      if (institutions.length > 0) params.set("inst", institutions.join(","));
      if (views.length > 0) params.set("view", views.join(","));
      if (lifeStages.length > 0) params.set("life", lifeStages.join(","));
      if (sexes.length > 0) params.set("sex", sexes.join(","));
      if (groups.length > 0) params.set("type", groups.join(","));
      const url = `/api/gallery/page/${next}?${params}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`page ${next} failed: ${res.status}`);
      const data = (await res.json()) as SearchGalleryResult;
      // If a filter-change aborted us mid-flight, bail before appending.
      if (controller.signal.aborted) return;
      setRows((prev) => [...prev, ...data.rows]);
      setPage(next);
      setHasMore(data.hasMore);
    } catch {
      // swallow — retry on next intersection (also covers AbortError)
    } finally {
      if (inflightRef.current === controller) inflightRef.current = null;
      setLoading(false);
    }
  }, [loading, hasMore, page, q, subject, institutions, views, lifeStages, sexes, groups]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMore();
        }
      },
      { rootMargin: "600px" }, // pre-fetch before the sentinel hits the viewport
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <>
      <div className="gallery-grid" id="gallery-grid" aria-busy={loading}>
        {rows.map((row) => (
          <GridTile key={row.image_id} row={row} />
        ))}
      </div>
      <div className="u-sr-only" role="status" aria-live="polite">
        {loading ? "loading more bugs" : ""}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="gallery-sentinel" aria-hidden>
          {loading ? "loading more bugs…" : ""}
        </div>
      )}
      {!hasMore && rows.length >= initial.pageSize && (
        <p className="gallery-end-marker">✿ that&apos;s every bug</p>
      )}
    </>
  );
}
