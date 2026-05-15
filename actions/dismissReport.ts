"use server";

import { db } from "@/db";
import { reports } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { invalidateOnDismiss } from "./_invalidation";

export async function dismissReport(reportId: number): Promise<void> {
  await requireAdmin();

  const existing = db.select().from(reports).where(eq(reports.id, reportId)).all();
  if (existing.length === 0) {
    throw new Error(`unknown report id: ${reportId}`);
  }

  db.update(reports)
    .set({
      resolvedAt: new Date(),
      resolvedAction: "dismissed",
    })
    .where(eq(reports.id, reportId))
    .run();

  invalidateOnDismiss();
}
