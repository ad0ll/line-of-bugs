"use client";

import { useId, useState } from "react";
import type { ReportCategory, SubmitReportArgs } from "@/lib/report-categories";
import { ReportCategoryChips } from "./ReportCategoryChips";
import { showToast } from "@/app/components/ui/Toast";

export interface ReportFormProps {
  imageId: string;
  onSubmit: (args: SubmitReportArgs) => Promise<void>;
  onClose: () => void;
  /** When set, the "report this image" heading uses this id so a parent
   *  dialog can reference it via aria-labelledby. */
  headingId?: string;
}

export function ReportForm({ imageId, onSubmit, onClose, headingId }: ReportFormProps) {
  const helpId = useId();
  const errorId = useId();
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
      <h2 id={headingId}>report this image</h2>
      <p className="report-form-help" id={helpId}>
        why should the admin take another look?
        <span aria-hidden="true" style={{ color: "var(--accent-danger)" }}> *</span>
        <span className="u-sr-only">required</span>
      </p>
      <ReportCategoryChips
        value={category}
        onChange={setCategory}
        ariaLabelledBy={helpId}
        required
      />
      {category === "other" && (
        <textarea
          maxLength={250}
          rows={4}
          placeholder="tell us a bit more (optional, 250 chars)"
          aria-label="additional details"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      )}
      {error && (
        <p className="report-form-error" id={errorId} role="alert">
          {error}
        </p>
      )}
      <div className="report-form-actions">
        <button type="button" onClick={onClose}>cancel</button>
        <button
          type="submit"
          disabled={!canSubmit}
          aria-describedby={error ? errorId : undefined}
        >
          {submitting ? "submitting…" : "submit"}
        </button>
      </div>
    </form>
  );
}
