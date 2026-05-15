import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/db";
import { images } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ReportPageClient } from "./ReportPageClient";

type Params = Promise<{ id: string }>;

export default function ReportPage({ params }: { params: Params }) {
  return (
    <main className="report-page">
      <h1 className="u-sr-only">report image</h1>
      <header className="report-page-header">
        <a href="/" className="report-page-back">← back</a>
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
  const row = db.select().from(images).where(eq(images.imageId, id)).all();
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
