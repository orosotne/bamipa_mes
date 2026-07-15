// Pretoky / orez per výrobný príkaz (D5: likvidácia = 100 % strata; kg =
// KPI odpadovosti). Stav príkazu stráži DB trigger (0004).
import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

export async function zapisOrez(
  db: DbClient,
  vstup: {
    userId: string;
    workOrderId: string;
    /** numeric(12,3) string — hmotnosť odpadu */
    qtyKg: string;
    /** "YYYY-MM-DD" */
    recordDate: string;
    note?: string;
  },
): Promise<typeof schema.scrapRecords.$inferSelect> {
  const kg = Number(vstup.qtyKg);
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error("Hmotnosť odpadu musí byť kladná.");
  }

  const [zaznam] = await db
    .insert(schema.scrapRecords)
    .values({
      workOrderId: vstup.workOrderId,
      qtyKg: vstup.qtyKg,
      recordDate: vstup.recordDate,
      note: vstup.note ?? null,
      createdBy: vstup.userId,
    })
    .returning();

  return zaznam;
}

export async function zmazOrez(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [zaznam] = await tx
      .select({ id: schema.scrapRecords.id })
      .from(schema.scrapRecords)
      .where(
        and(
          eq(schema.scrapRecords.id, vstup.id),
          isNull(schema.scrapRecords.deletedAt),
        ),
      );
    if (!zaznam) throw new Error("Záznam orezu neexistuje.");

    await tx
      .update(schema.scrapRecords)
      .set({ deletedAt: new Date() })
      .where(eq(schema.scrapRecords.id, vstup.id));

    // SPEC §4: audit trail — soft delete by inak nezachytil KTO mazal.
    await tx.insert(schema.auditLog).values({
      tableName: "scrap_records",
      recordId: vstup.id,
      action: "delete",
      changedBy: vstup.userId,
      changes: null,
    });
  });
}
