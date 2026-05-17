"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { ReportForm } from "@/app/components/report/ReportForm";
import { submitReport } from "@/actions/submitReport";
import { basename } from "@/lib/path-utils";

interface ReportPageClientProps {
  imageId: string;
  thumbnail: string;
  width: number;
  height: number;
  commonName: string | null;
  speciesName: string | null;
  sourcePageUrl: string;
  source: string;
}

function sourceName(src: string): string {
  if (src === "inaturalist") return "iNaturalist";
  if (src === "bugwood") return "Bugwood";
  return src;
}

export function ReportPageClient({
  imageId,
  thumbnail,
  width,
  height,
  commonName,
  speciesName,
  sourcePageUrl,
  source,
}: ReportPageClientProps) {
  const router = useRouter();
  return (
    <div className="report-page-content">
      <div className="report-page-preview">
        <Image
          src={`/api/thumb/${basename(thumbnail)}`}
          alt={commonName ?? speciesName ?? "reported specimen"}
          width={width}
          height={height}
          className="report-page-preview-img"
        />
        <p className="preview-name">{commonName ?? speciesName ?? imageId}</p>
        {commonName && speciesName && (
          <p className="preview-species">{speciesName}</p>
        )}
        {sourcePageUrl && (
          <a
            className="preview-source"
            href={sourcePageUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            view on {sourceName(source)} ↗
          </a>
        )}
      </div>
      <ReportForm
        imageId={imageId}
        onSubmit={submitReport}
        onClose={() => router.push("/")}
      />
    </div>
  );
}
