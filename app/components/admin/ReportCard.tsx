"use client";

import type { PendingReport } from "@/lib/queries/reports";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { orderColor } from "@/lib/order-colors";

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

function formatAge(unixSeconds: number): string {
  const elapsed = Date.now() / 1000 - unixSeconds;
  if (elapsed < 60) return `${Math.floor(elapsed)}s ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  return `${Math.floor(elapsed / 86400)}d ago`;
}

export interface ReportCardProps {
  report: PendingReport;
  onDismiss: (reportId: number) => Promise<void> | void;
  onHide: (imageId: string) => Promise<void> | void;
  onDelete: (imageId: string) => Promise<void>;
}

export function ReportCard({ report, onDismiss, onHide, onDelete }: ReportCardProps) {
  return (
    <article className="report-card">
      <div className="report-card-thumb">
        <img src={`/api/thumb/${basename(report.thumbnail_filename)}`} alt="" />
        <span
          className="report-card-stripe"
          style={{ backgroundColor: orderColor(report.taxon_order) }}
        />
      </div>
      <div className="report-card-body">
        <header className="report-card-header">
          <span className="report-card-category">{report.category}</span>
          <span className="report-card-age">{formatAge(report.created_at)}</span>
        </header>
        <p className="report-card-name">
          {report.common_name ?? report.taxon_species ?? report.image_id}
        </p>
        <p className="report-card-meta">
          <span className="report-card-id">{report.image_id}</span>
          {" · "}
          <span className="report-card-source">{report.source}</span>
          {" · "}
          <a className="report-card-source-link" href={report.source_page_url} target="_blank" rel="noopener noreferrer">
            source ↗
          </a>
        </p>
        {report.message && <blockquote className="report-card-message">{report.message}</blockquote>}
        {report.hidden === 1 && <p className="report-card-warning">⚠ this image is already hidden</p>}
        <div className="report-card-actions">
          <button type="button" onClick={() => onDismiss(report.id)}>dismiss</button>
          <button type="button" onClick={() => onHide(report.image_id)}>hide image</button>
          <ConfirmDeleteButton onConfirm={() => Promise.resolve(onDelete(report.image_id))} />
        </div>
      </div>
    </article>
  );
}
