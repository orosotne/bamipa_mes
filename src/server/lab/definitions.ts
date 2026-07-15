// M5 Labák — správa tolerančných limitov per zmes (lab_test_definitions).
// Konfigurovateľné QC parametre bez hardcoded stĺpcov (SPEC M5). DI DbClient.
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { formatQty, parseQty } from "@/server/inventory/money";

/** "12,5" / "10" / "" / null → "12.500" | null (prázdne = bez limitu). */
function normalizujLimit(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const t = String(input).replace(/[\s ]/g, "").replace(",", ".");
  if (t === "") return null;
  if (!/^-?\d+(\.\d{1,3})?$/.test(t)) {
    throw new Error(`Neplatná hodnota limitu: „${input}".`);
  }
  return formatQty(parseQty(t));
}

/**
 * Upsert tolerančného limitu (min/max) pre parameter zmesi. Obe prázdne = limit
 * sa zruší (soft delete). Vracia živý riadok alebo null pri zrušení.
 */
export async function ulozLimit(
  db: DbClient,
  vstup: {
    userId: string;
    mixtureId: string;
    parameterId: string;
    minValue?: string | null;
    maxValue?: string | null;
  },
): Promise<typeof schema.labTestDefinitions.$inferSelect | null> {
  const min = normalizujLimit(vstup.minValue);
  const max = normalizujLimit(vstup.maxValue);
  if (min !== null && max !== null && parseQty(min) > parseQty(max)) {
    throw new Error("Minimum nesmie byť väčšie ako maximum.");
  }

  return db.transaction(async (tx) => {
    const [existujuci] = await tx
      .select()
      .from(schema.labTestDefinitions)
      .where(
        and(
          eq(schema.labTestDefinitions.mixtureId, vstup.mixtureId),
          eq(schema.labTestDefinitions.parameterId, vstup.parameterId),
          isNull(schema.labTestDefinitions.deletedAt),
        ),
      );

    // Zrušenie limitu (obe prázdne).
    if (min === null && max === null) {
      if (existujuci) {
        await tx
          .update(schema.labTestDefinitions)
          .set({ deletedAt: new Date() })
          .where(eq(schema.labTestDefinitions.id, existujuci.id));
      }
      return null;
    }

    if (existujuci) {
      const [row] = await tx
        .update(schema.labTestDefinitions)
        .set({ minValue: min, maxValue: max })
        .where(eq(schema.labTestDefinitions.id, existujuci.id))
        .returning();
      return row;
    }

    const [row] = await tx
      .insert(schema.labTestDefinitions)
      .values({
        mixtureId: vstup.mixtureId,
        parameterId: vstup.parameterId,
        minValue: min,
        maxValue: max,
        createdBy: vstup.userId,
      })
      .returning();
    return row;
  });
}

export type LimitRiadok = {
  parameterId: string;
  code: string;
  name: string;
  unit: string | null;
  sortOrder: number;
  minValue: string | null;
  maxValue: string | null;
  definitionId: string | null;
};

/**
 * Všetky aktívne QC parametre s prípadným limitom zmesi (LEFT JOIN) — pre
 * editačnú tabuľku limitov. Parametre bez definície majú null hodnoty.
 */
export async function limityPreZmes(
  db: DbClient,
  mixtureId: string,
): Promise<LimitRiadok[]> {
  return db
    .select({
      parameterId: schema.labParameters.id,
      code: schema.labParameters.code,
      name: schema.labParameters.name,
      unit: schema.labParameters.unit,
      sortOrder: schema.labParameters.sortOrder,
      minValue: schema.labTestDefinitions.minValue,
      maxValue: schema.labTestDefinitions.maxValue,
      definitionId: schema.labTestDefinitions.id,
    })
    .from(schema.labParameters)
    .leftJoin(
      schema.labTestDefinitions,
      and(
        eq(schema.labTestDefinitions.parameterId, schema.labParameters.id),
        eq(schema.labTestDefinitions.mixtureId, mixtureId),
        isNull(schema.labTestDefinitions.deletedAt),
      ),
    )
    .where(
      and(
        eq(schema.labParameters.isActive, true),
        isNull(schema.labParameters.deletedAt),
      ),
    )
    .orderBy(asc(schema.labParameters.sortOrder));
}
