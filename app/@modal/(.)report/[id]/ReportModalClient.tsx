"use client";

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
  return (
    <Modal onClose={close} ariaLabel="report image">
      <div className="report-modal-content">
        <div className="report-modal-preview">
          <img src={`/api/thumb/${basename(thumbnail)}`} alt="" />
          <p className="preview-name">{commonName ?? speciesName ?? imageId}</p>
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
