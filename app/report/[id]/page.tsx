import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/db";
import { images } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { IMAGE_COLS_NO_RAW } from "@/lib/queries/_image-cols";
import { ReportPageClient } from "./ReportPageClient";

type Params = Promise<{ id: string }>;

export default function ReportPage({ params }: { params: Params }) {
  return (
    <main className="report-page">
      <header className="report-page-header">
        <Link href="/" className="report-page-back">← back</Link>
      </header>
      <Suspense fallback={<p>loading…</p>}>
        <ReportLoader params={params} />
      </Suspense>
    </main>
  );
}

async function ReportLoader({ params }: { params: Params }) {
  await connection();
  const { id } = await params;
  // Hidden images cannot be re-reported via direct URL — they're already out
  // of the gallery; surfacing a report form just lets bots refile dupes.
  // Projection skips raw_metadata — the report form only needs display fields.
  const row = db.select(IMAGE_COLS_NO_RAW)
    .from(images)
    .where(and(eq(images.imageId, id), eq(images.hidden, false)))
    .all();
  if (row.length === 0) notFound();
  const img = row[0]!;

  return (
    <ReportPageClient
      imageId={id}
      thumbnail={img.thumbnailFilename}
      width={img.width ?? 1}
      height={img.height ?? 1}
      commonName={img.commonName}
      speciesName={img.taxonSpecies}
    />
  );
}
