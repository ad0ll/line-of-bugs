"use client";

import { useState } from "react";
import type { ReportCategory, SubmitReportArgs } from "@/lib/report-categories";
import { ReportCategoryChips } from "./ReportCategoryChips";
import { showToast } from "@/app/components/ui/Toast";

export interface ReportFormProps {
  imageId: string;
  onSubmit: (args: SubmitReportArgs) => Promise<void>;
  onClose: () => void;
}

export function ReportForm({ imageId, onSubmit, onClose }: ReportFormProps) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = category !== null && !submitting;

  async function handleSubmit() {
    if (!category) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        imageId,
        category,
        message: category === "other" && message.trim().length > 0 ? message : null,
      });
      showToast("thanks — admin will review");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to submit");
      setSubmitting(false);
    }
  }

  return (
    <form
      className="report-form"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <h2>report this image</h2>
      <p className="report-form-help">why should the admin take another look?</p>
      <ReportCategoryChips value={category} onChange={setCategory} />
      {category === "other" && (
        <textarea
          maxLength={250}
          rows={4}
          placeholder="tell us a bit more (optional, 250 chars)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      )}
      {error && <p className="report-form-error">{error}</p>}
      <div className="report-form-actions">
        <button type="button" onClick={onClose}>cancel</button>
        <button type="submit" disabled={!canSubmit}>
          {submitting ? "submitting…" : "submit"}
        </button>
      </div>
    </form>
  );
}
