import { getTableColumns } from "drizzle-orm";
import { schema } from "@/db";

// All columns of `images` EXCEPT raw_metadata. Use this for any
// db.select() that doesn't need the upstream API archival blob —
// which is currently every reader in the codebase. raw_metadata
// stays stored (fetcher still writes it); we just don't haul it
// back into Node memory on every read.
//
// Why this matters: raw_metadata averages ~121 KB per row. The worst
// offender, buildSessionPool, pulls up to 500 rows on every session
// start (~60 MB) and parks them in the session-pool map until TTL.
const { rawMetadata: _omit, ...slimImageCols } = getTableColumns(schema.images);
export const IMAGE_COLS_NO_RAW = slimImageCols;
export type ImageNoRaw = typeof slimImageCols extends infer T
  ? { [K in keyof T]: T[K] extends { _: { data: infer D } } ? D : never }
  : never;
