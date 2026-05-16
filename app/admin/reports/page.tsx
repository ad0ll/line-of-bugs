import { Suspense } from "react";
import { getPendingReports, getPendingCount } from "@/lib/queries/reports";
import { dismissReport } from "@/actions/dismissReport";
import { hideImage } from "@/actions/hideImage";
import { deleteImage } from "@/actions/deleteImage";
import { ReportListClient } from "./_actions";
import { AutoRefresh } from "@/app/components/admin/AutoRefresh";

export default async function AdminReportsPage() {
  return (
    <main className="admin-page">
      {/* Background poll so a moderator with the queue open sees new reports
          without manually reloading. AutoRefresh is a tiny client component
          that calls router.refresh() on an interval. */}
      <AutoRefresh />
      <header className="admin-page-header">
        <h1>reports</h1>
        <Suspense fallback={<span>…</span>}><PendingCount /></Suspense>
      </header>
      <Suspense fallback={<p>loading…</p>}>
        <Inner />
      </Suspense>
    </main>
  );
}

async function PendingCount() {
  const n = await getPendingCount();
  return <span className="admin-page-count">{n} pending</span>;
}

async function Inner() {
  const reports = await getPendingReports();
  return (
    <ReportListClient
      reports={reports}
      actions={{
        dismiss: dismissReport,
        hide: hideImage,
        deleteImg: deleteImage,
      }}
    />
  );
}
