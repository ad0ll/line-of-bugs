"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PendingReport } from "@/lib/queries/reports";
import { ReportCard } from "@/app/components/admin/ReportCard";

export interface ReportListClientProps {
  reports: PendingReport[];
  actions: {
    dismiss: (id: number) => Promise<void>;
    hide: (imageId: string) => Promise<void>;
    deleteImg: (imageId: string) => Promise<void>;
  };
}

export function ReportListClient({ reports, actions }: ReportListClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function refresh() {
    startTransition(() => router.refresh());
  }

  if (reports.length === 0) {
    return <p className="admin-empty">no pending reports — nice job, students 🌿</p>;
  }

  return (
    <div className="report-list">
      {reports.map((r) => (
        <ReportCard
          key={r.id}
          report={r}
          onDismiss={async (id) => { await actions.dismiss(id); refresh(); }}
          onHide={async (imageId) => { await actions.hide(imageId); refresh(); }}
          onDelete={async (imageId) => { await actions.deleteImg(imageId); refresh(); }}
        />
      ))}
    </div>
  );
}
