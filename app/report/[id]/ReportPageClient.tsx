"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { ReportForm } from "@/app/components/report/ReportForm";
import { submitReport } from "@/actions/submitReport";

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

interface ReportPageClientProps {
  imageId: string;
  thumbnail: string;
  width: number;
  height: number;
  commonName: string | null;
  speciesName: string | null;
}

export function ReportPageClient({
  imageId,
  thumbnail,
  width,
  height,
  commonName,
  speciesName,
}: ReportPageClientProps) {
  const router = useRouter();
  return (
    <div className="report-page-content">
      <div className="report-page-preview">
        <Image
          src={`/api/thumb/${basename(thumbnail)}`}
          alt=""
          width={width}
          height={height}
          style={{ width: "100%", height: "auto", maxWidth: 320, borderRadius: "var(--r-3xl)" }}
        />
        <p className="preview-name">{commonName ?? speciesName ?? imageId}</p>
      </div>
      <ReportForm
        imageId={imageId}
        onSubmit={submitReport}
        onClose={() => router.push("/")}
      />
    </div>
  );
}
