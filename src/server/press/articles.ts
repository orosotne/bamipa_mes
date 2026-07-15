// Katalóg artiklov (M6 — sole_models). Vzor machines/service.ts: DI DbClient,
// slovenské doménové chyby, audit_log pri každej mutácii, soft delete guard.
// Zmenu zmesi pri živých príkazoch blokuje DB trigger (0004) — hláška sa
// propaguje surová.
import { eq } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { sqlState } from "@/server/action-utils";

export type ArtikelPolia = {
  code: string;
  name: string;
  mixtureId: string;
  /** numeric(12,3) string — norma spotreby zmesi na pár (kg) */
  mixtureKgPerPair: string;
  targetCycleSeconds?: number | null;
  salePriceCents?: number | null;
  isActive?: boolean;
};

function validuj(polia: ArtikelPolia): { code: string; name: string } {
  const code = polia.code.trim();
  const name = polia.name.trim();
  if (!code) throw new Error("Kód artikla nesmie byť prázdny.");
  if (!name) throw new Error("Názov artikla nesmie byť prázdny.");
  const norma = Number(polia.mixtureKgPerPair);
  if (!Number.isFinite(norma) || norma <= 0) {
    throw new Error("Norma spotreby zmesi na pár musí byť kladná.");
  }
  if (polia.targetCycleSeconds != null && polia.targetCycleSeconds <= 0) {
    throw new Error("Cieľový čas cyklu musí byť kladný.");
  }
  if (polia.salePriceCents != null && polia.salePriceCents <= 0) {
    throw new Error("Predajná cena musí byť kladná.");
  }
  return { code, name };
}

export async function vytvorArtikel(
  db: DbClient,
  vstup: { userId: string } & ArtikelPolia,
): Promise<typeof schema.soleModels.$inferSelect> {
  const { code, name } = validuj(vstup);

  try {
    return await db.transaction(async (tx) => {
      const [artikel] = await tx
        .insert(schema.soleModels)
        .values({
          code,
          name,
          mixtureId: vstup.mixtureId,
          mixtureKgPerPair: vstup.mixtureKgPerPair,
          targetCycleSeconds: vstup.targetCycleSeconds ?? null,
          salePriceCents: vstup.salePriceCents ?? null,
          isActive: vstup.isActive ?? true,
          createdBy: vstup.userId,
        })
        .returning();

      await tx.insert(schema.auditLog).values({
        tableName: "sole_models",
        recordId: artikel.id,
        action: "insert",
        changedBy: vstup.userId,
        changes: { new: { code, name } },
      });

      return artikel;
    });
  } catch (e) {
    if (sqlState(e) === "23505") {
      throw new Error(`Artikel s kódom „${code}" už existuje.`);
    }
    throw e;
  }
}

export async function updateArtikel(
  db: DbClient,
  vstup: { userId: string; id: string } & ArtikelPolia,
): Promise<typeof schema.soleModels.$inferSelect> {
  const { code, name } = validuj(vstup);

  try {
    return await db.transaction(async (tx) => {
      const [povodny] = await tx
        .select()
        .from(schema.soleModels)
        .where(eq(schema.soleModels.id, vstup.id));
      if (!povodny) {
        throw new Error("Artikel neexistuje.");
      }

      const [upraveny] = await tx
        .update(schema.soleModels)
        .set({
          code,
          name,
          mixtureId: vstup.mixtureId,
          mixtureKgPerPair: vstup.mixtureKgPerPair,
          targetCycleSeconds: vstup.targetCycleSeconds ?? null,
          salePriceCents: vstup.salePriceCents ?? null,
          isActive: vstup.isActive ?? povodny.isActive,
        })
        .where(eq(schema.soleModels.id, vstup.id))
        .returning();

      await tx.insert(schema.auditLog).values({
        tableName: "sole_models",
        recordId: vstup.id,
        action: "update",
        changedBy: vstup.userId,
        changes: {
          old: { code: povodny.code, name: povodny.name },
          new: { code, name },
        },
      });

      return upraveny;
    });
  } catch (e) {
    if (sqlState(e) === "23505") {
      throw new Error(`Artikel s kódom „${code}" už existuje.`);
    }
    throw e;
  }
}

/** Guard: artikel s výrobnými príkazmi sa nemaže (dokladová história). */
export async function softDeleteArtikel(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [prikaz] = await tx
      .select({ id: schema.workOrders.id })
      .from(schema.workOrders)
      .where(eq(schema.workOrders.soleModelId, vstup.id))
      .limit(1);
    if (prikaz) {
      throw new Error(
        "Artikel nemožno zmazať — existujú k nemu výrobné príkazy. Doklady sa nemažú.",
      );
    }

    await tx
      .update(schema.soleModels)
      .set({ deletedAt: new Date() })
      .where(eq(schema.soleModels.id, vstup.id));

    await tx.insert(schema.auditLog).values({
      tableName: "sole_models",
      recordId: vstup.id,
      action: "delete",
      changedBy: vstup.userId,
      changes: null,
    });
  });
}
