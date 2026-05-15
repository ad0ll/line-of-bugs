"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { GalleryRow, SearchGalleryResult } from "@/lib/queries/gallery";
import type { SubjectType } from "@/lib/subject";
import { GridTile } from "./GridTile";

interface Props {
  initial: SearchGalleryResult;
  q: string;
  subject: SubjectType;
  institutions: string[];
  views: string[];
  lifeStages: string[];
  sexes: string[];
  groups: string[];
}

export function InfiniteScroller({
  initial, q, subject, institutions, views, lifeStages, sexes, groups,
}: Props) {
  const [rows, setRows] = useState<GalleryRow[]>(initial.rows);
  const [page, setPage] = useState(initial.page);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset state if the query identity changes (parent re-renders with new filters)
  useEffect(() => {
    setRows(initial.rows);
    setPage(initial.page);
    setHasMore(initial.hasMore);
  }, [initial]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const next = page + 1;
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (subject !== "all") params.set("subject", subject);
      if (institutions.length > 0) params.set("inst", institutions.join(","));
      if (views.length > 0) params.set("view", views.join(","));
      if (lifeStages.length > 0) params.set("life", lifeStages.join(","));
      if (sexes.length > 0) params.set("sex", sexes.join(","));
      if (groups.length > 0) params.set("type", groups.join(","));
      const url = `/api/gallery/page/${next}?${params}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`page ${next} failed: ${res.status}`);
      const data = (await res.json()) as SearchGalleryResult;
      setRows((prev) => [...prev, ...data.rows]);
      setPage(next);
      setHasMore(data.hasMore);
    } catch {
      // swallow — retry on next intersection
    } finally {
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
      <div className="gallery-grid" id="gallery-grid">
        {rows.map((row) => (
          <GridTile key={row.image_id} row={row} />
        ))}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="gallery-sentinel" aria-hidden>
          {loading ? "loading more bugs…" : ""}
        </div>
      )}
      {!hasMore && rows.length > initial.pageSize && (
        <p className="gallery-end-marker">✿ that&apos;s every bug</p>
      )}
    </>
  );
}
