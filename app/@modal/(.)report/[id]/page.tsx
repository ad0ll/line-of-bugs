import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/db";
import { images } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ReportModalClient } from "./ReportModalClient";

type Params = Promise<{ id: string }>;

export default function ReportModalRoute({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <ReportModalLoader params={params} />
    </Suspense>
  );
}

async function ReportModalLoader({ params }: { params: Params }) {
  await connection();
  const { id } = await params;
  const row = db.select().from(images).where(eq(images.imageId, id)).all();
  if (row.length === 0) notFound();
  const img = row[0]!;

  return (
    <ReportModalClient
      imageId={id}
      thumbnail={img.thumbnailFilename}
      commonName={img.commonName}
      speciesName={img.taxonSpecies}
    />
  );
}
