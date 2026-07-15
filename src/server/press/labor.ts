// Práca lisovne per výrobný príkaz (lisovanie, orez, zapravenie, balenie) —
// vstup nákladu na pár (SPEC M7). Zrkadlo batch_labor: snapshot sadzby
// z labor_rates k dátumu práce. Stav príkazu stráži DB trigger (0004).
import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { sadzbaKDatumu } from "@/server/workers/service";

export async function zapisPracu(
  db: DbClient,
  vstup: {
    userId: string;
    workOrderId: string;
    workerId: string;
    /** "YYYY-MM-DD" */
    workDate: string;
    /** numeric(6,2) string */
    hours: string;
    note?: string;
  },
): Promise<typeof schema.workOrderLabor.$inferSelect> {
  const hodiny = Number(vstup.hours);
  if (!Number.isFinite(hodiny) || hodiny <= 0) {
    throw new Error("Počet hodín musí byť kladný.");
  }
  const sadzba = await sadzbaKDatumu(db, vstup.workerId, vstup.workDate);

  const [zaznam] = await db
    .insert(schema.workOrderLabor)
    .values({
      workOrderId: vstup.workOrderId,
      workerId: vstup.workerId,
      workDate: vstup.workDate,
      hours: vstup.hours,
      hourlyRateCents: sadzba.hourlyRateCents,
      note: vstup.note ?? null,
      createdBy: vstup.userId,
    })
    .returning();

  return zaznam;
}

export async function zmazPracu(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<void> {
  const [zaznam] = await db
    .select({ id: schema.workOrderLabor.id })
    .from(schema.workOrderLabor)
    .where(
      and(
        eq(schema.workOrderLabor.id, vstup.id),
        isNull(schema.workOrderLabor.deletedAt),
      ),
    );
  if (!zaznam) throw new Error("Záznam práce neexistuje.");

  await db
    .update(schema.workOrderLabor)
    .set({ deletedAt: new Date() })
    .where(eq(schema.workOrderLabor.id, vstup.id));
}
