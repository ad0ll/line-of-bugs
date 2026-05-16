"use server";

import { db } from "@/db";
import { reports } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { invalidateOnDismiss } from "./_invalidation";

export async function dismissReport(reportId: number): Promise<void> {
  await requireAdmin();

  const existing = db.select().from(reports).where(eq(reports.id, reportId)).all();
  if (existing.length === 0) {
    throw new Error(`unknown report id: ${reportId}`);
  }

  // Only resolve rows that are still unresolved — racing admin clicks must not
  // overwrite a prior resolution (e.g. dismiss after hide would lose the
  // image-hidden audit trail).
  const result = db.update(reports)
    .set({
      resolvedAt: new Date(),
      resolvedAction: "dismissed",
    })
    .where(and(eq(reports.id, reportId), isNull(reports.resolvedAt)))
    .run();

  if (result.changes === 0) {
    throw new Error("report already resolved");
  }

  invalidateOnDismiss();
}
