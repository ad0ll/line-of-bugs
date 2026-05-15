/**
 * Seed the SQLite database from the per-source manifest CSVs.
 *
 * Idempotent: re-running upserts existing rows by image_id. New rows are
 * inserted, existing rows are left untouched (the file system is the source
 * of truth for image bytes; the manifest is the source of truth for
 * metadata).
 *
 * Usage:
 *   npx tsx db/seed.ts             # all sources
 *   npx tsx db/seed.ts inaturalist # specific source(s)
 */
import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";

import { db, schema } from "./index";

const MANIFEST_DIR = path.resolve("data/manifest");
const ALL_SOURCES = ["inaturalist", "bugwood", "smithsonian", "usda_ars"] as const;

// CSV column name → schema field (snake_case → camelCase)
function rowFromCsv(r: Record<string, string>): schema.NewImage {
  return {
    imageId: r.image_id!,
    collectionId: r.collection_id!,
    source: r.source as schema.Source,
    sourceId: r.source_id!,
    sourcePageUrl: r.source_page_url!,
    imageUrl: r.image_url!,
    filename: r.filename!,
    thumbnailFilename: r.thumbnail_filename!,
    mediumFilename: r.medium_filename!,
    fileSizeBytes: r.file_size_bytes ? Number(r.file_size_bytes) : null,
    fileSha256: r.file_sha256!,
    width: r.width ? Number(r.width) : null,
    height: r.height ? Number(r.height) : null,
    license: r.license!,
    licenseUrl: r.license_url || null,
    photographerAttribution: r.photographer_attribution || null,
    photographer: r.photographer || null,
    institution: r.institution || null,
    taxonOrder: r.taxon_order || null,
    taxonSpecies: r.taxon_species || null,
    commonName: r.common_name || null,
    subjectState: r.subject_state as schema.SubjectState,
    viewLabel: r.view_label || null,
    lifeStage: (r.life_stage || null) as schema.LifeStage | null,
    sex: (r.sex || null) as schema.Sex | null,
    hostOrganism: r.host_organism || null,
    specimenCondition: r.specimen_condition || null,
    description: r.description || null,
    capturedDate: r.captured_date || null,
    rawMetadata: r.raw_metadata || null,
  };
}

function loadCsv(file: string): schema.NewImage[] {
  const text = fs.readFileSync(file, "utf8");
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];
  return records.map(rowFromCsv);
}

async function main() {
  const requested = process.argv.slice(2);
  const sources = requested.length ? requested : (ALL_SOURCES as readonly string[]);

  let total = 0;
  for (const src of sources) {
    const file = path.join(MANIFEST_DIR, `${src}.csv`);
    if (!fs.existsSync(file)) {
      console.warn(`  missing manifest: ${file}`);
      continue;
    }
    const rows = loadCsv(file);
    // Upsert in chunks of 500 inside a single transaction per chunk
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      db.transaction((tx) => {
        for (const row of batch) {
          tx.insert(schema.images)
            .values(row)
            .onConflictDoUpdate({
              target: schema.images.imageId,
              set: {
                collectionId: row.collectionId,
                sourcePageUrl: row.sourcePageUrl,
                imageUrl: row.imageUrl,
                filename: row.filename,
                thumbnailFilename: row.thumbnailFilename,
                mediumFilename: row.mediumFilename,
                fileSizeBytes: row.fileSizeBytes,
                fileSha256: row.fileSha256,
                width: row.width,
                height: row.height,
                license: row.license,
                licenseUrl: row.licenseUrl,
                photographerAttribution: row.photographerAttribution,
                photographer: row.photographer,
                institution: row.institution,
                taxonOrder: row.taxonOrder,
                taxonSpecies: row.taxonSpecies,
                commonName: row.commonName,
                subjectState: row.subjectState,
                viewLabel: row.viewLabel,
                lifeStage: row.lifeStage,
                sex: row.sex,
                hostOrganism: row.hostOrganism,
                specimenCondition: row.specimenCondition,
                description: row.description,
                capturedDate: row.capturedDate,
                rawMetadata: row.rawMetadata,
              },
            })
            .run();
        }
      });
    }
    console.log(`  ${src.padEnd(14)} seeded ${rows.length} rows`);
    total += rows.length;
  }

  // Quick sanity check
  const count = await db.$count(schema.images);
  console.log(`\nimages.count() = ${count}  (seeded total: ${total})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
