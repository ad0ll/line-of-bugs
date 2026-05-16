"use client";

import { useId } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Modal } from "@/app/components/modal/Modal";
import { ReportForm } from "@/app/components/report/ReportForm";
import { submitReport } from "@/actions/submitReport";
import { basename } from "@/lib/path-utils";

interface ReportModalClientProps {
  imageId: string;
  thumbnail: string;
  commonName: string | null;
  speciesName: string | null;
}

export function ReportModalClient({ imageId, thumbnail, commonName, speciesName }: ReportModalClientProps) {
  const router = useRouter();
  const close = () => router.back();
  // aria-labelledby points at the "report this image" h2 inside ReportForm
  // so AT users hear the modal's purpose, not the specimen name. The form
  // accepts the id as a prop to keep the markup co-located with the heading.
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
          <p className="preview-name">{commonName ?? speciesName ?? imageId}</p>
        </div>
        <ReportForm
          imageId={imageId}
          onSubmit={submitReport}
          onClose={close}
          headingId={headingId}
        />
      </div>
    </Modal>
  );
}
