"use client";

import { useId } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Modal } from "@/app/components/modal/Modal";
import { ReportForm } from "@/app/components/report/ReportForm";
import { submitReport } from "@/actions/submitReport";

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

interface ReportModalClientProps {
  imageId: string;
  thumbnail: string;
  commonName: string | null;
  speciesName: string | null;
}

export function ReportModalClient({ imageId, thumbnail, commonName, speciesName }: ReportModalClientProps) {
  const router = useRouter();
  const close = () => router.back();
  // ID for the visible heading the dialog references via aria-labelledby.
  // The element with this id is the "report this image" h2-equivalent text
  // — using the specimen name keeps screen readers oriented to which image
  // they're reporting.
  const headingId = useId();
  return (
    <Modal onClose={close} ariaLabelledBy={headingId}>
      <div className="report-modal-content">
        <div className="report-modal-preview">
          <Image
            src={`/api/thumb/${basename(thumbnail)}`}
            alt={commonName ?? speciesName ?? "reported specimen"}
            width={160}
            height={160}
          />
          <p id={headingId} className="preview-name">{commonName ?? speciesName ?? imageId}</p>
        </div>
        <ReportForm
          imageId={imageId}
          onSubmit={submitReport}
          onClose={close}
        />
      </div>
    </Modal>
  );
}
