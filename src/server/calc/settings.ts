// Alokačné nastavenia M7 (D4 pomer energií) — spravuje len admin (SPEC §4),
// vynucuje action vrstva. Jediný živý riadok code='default'.
import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

export async function ulozNastavenia(
  db: DbClient,
  vstup: { userId: string; energyValcovnaPct: number },
): Promise<void> {
  const pct = vstup.energyValcovnaPct;
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
    throw new Error("Pomer D4 musí byť celé číslo 0–100 %.");
  }
  await db.transaction(async (tx) => {
    const [existujuce] = await tx
      .select()
      .from(schema.calcSettings)
      .where(
        and(
          eq(schema.calcSettings.code, "default"),
          isNull(schema.calcSettings.deletedAt),
        ),
      );

    let id: string;
    if (existujuce) {
      await tx
        .update(schema.calcSettings)
        .set({ energyValcovnaPct: pct, energyLisovnaPct: 100 - pct })
        .where(eq(schema.calcSettings.id, existujuce.id));
      id = existujuce.id;
    } else {
      const [nove] = await tx
        .insert(schema.calcSettings)
        .values({
          code: "default",
          energyValcovnaPct: pct,
          energyLisovnaPct: 100 - pct,
          createdBy: vstup.userId,
        })
        .returning();
      id = nove.id;
    }

    await tx.insert(schema.auditLog).values({
      tableName: "calc_settings",
      recordId: id,
      action: "update",
      changedBy: vstup.userId,
      changes: {
        energy_valcovna_pct: {
          old: existujuce?.energyValcovnaPct ?? null,
          new: pct,
        },
      },
    });
  });
}
