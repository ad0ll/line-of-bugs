import { db } from "@/db";
import { sql } from "drizzle-orm";
import { cacheTag, cacheLife } from "next/cache";

export type PendingReport = {
  id: number;
  image_id: string;
  category: string;
  message: string | null;
  created_at: number;
  thumbnail_filename: string;
  source: string;
  source_page_url: string;
  common_name: string | null;
  taxon_species: string | null;
  taxon_order: string | null;
  hidden: number;
};

export async function getPendingReports(): Promise<PendingReport[]> {
  "use cache";
  cacheTag("reports");
  cacheLife("minutes");

  return db.all<PendingReport>(sql`
    SELECT
      r.id, r.image_id, r.category, r.message, r.created_at,
      i.thumbnail_filename, i.source, i.source_page_url,
      i.common_name, i.taxon_species, i.taxon_order, i.hidden
    FROM reports r
    JOIN images i ON i.image_id = r.image_id
    WHERE r.resolved_at IS NULL
    ORDER BY r.created_at DESC, r.id DESC
  `);
}

export async function getPendingCount(): Promise<number> {
  "use cache";
  cacheTag("reports");
  cacheLife("minutes");

  const row = db.get<{ c: number }>(sql`
    SELECT COUNT(*) AS c FROM reports WHERE resolved_at IS NULL
  `);
  return row?.c ?? 0;
}
