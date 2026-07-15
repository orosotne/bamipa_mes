// Karty materiálov (M2). Vzory z M1: DI DbClient, slovenské chyby, audit_log.
// Guard mazania: materiál so šaržami na sklade alebo v receptúre sa nemaže.
import { asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { sqlState } from "@/server/action-utils";

export type MaterialPolia = {
  code: string;
  name: string;
  unit: (typeof schema.materialUnit.enumValues)[number];
  category: (typeof schema.materialCategory.enumValues)[number];
  /** numeric(12,3) string alebo null */
  minStockQty?: string | null;
  note?: string | null;
};

function validuj(polia: MaterialPolia): { code: string; name: string } {
  const code = polia.code.trim();
  const name = polia.name.trim();
  if (!code) throw new Error("Kód materiálu nesmie byť prázdny.");
  if (!name) throw new Error("Názov materiálu nesmie byť prázdny.");
  return { code, name };
}

export async function createMaterial(
  db: DbClient,
  vstup: { userId: string } & MaterialPolia,
): Promise<typeof schema.materials.$inferSelect> {
  const { code, name } = validuj(vstup);

  try {
    return await db.transaction(async (tx) => {
      const [material] = await tx
        .insert(schema.materials)
        .values({
          code,
          name,
          unit: vstup.unit,
          category: vstup.category,
          minStockQty: vstup.minStockQty ?? null,
          note: vstup.note ?? null,
          createdBy: vstup.userId,
        })
        .returning();

      await tx.insert(schema.auditLog).values({
        tableName: "materials",
        recordId: material.id,
        action: "insert",
        changedBy: vstup.userId,
        changes: { new: { code, name } },
      });

      return material;
    });
  } catch (e) {
    if (sqlState(e) === "23505") {
      throw new Error(`Materiál s kódom „${code}" už existuje.`);
    }
    throw e;
  }
}

export async function updateMaterial(
  db: DbClient,
  vstup: { userId: string; id: string } & MaterialPolia,
): Promise<typeof schema.materials.$inferSelect> {
  const { code, name } = validuj(vstup);

  try {
    return await db.transaction(async (tx) => {
      const [povodny] = await tx
        .select()
        .from(schema.materials)
        .where(eq(schema.materials.id, vstup.id));
      if (!povodny) {
        throw new Error("Materiál neexistuje.");
      }

      // Guard: zmena MJ so šaržami/receptúrou by ticho reinterpretovala
      // existujúce množstvá (500 kg → 500 ks).
      if (vstup.unit !== povodny.unit) {
        const [lot] = await tx
          .select({ id: schema.materialLots.id })
          .from(schema.materialLots)
          .where(eq(schema.materialLots.materialId, vstup.id))
          .limit(1);
        const [polozka] = lot
          ? [undefined]
          : await tx
              .select({ id: schema.recipeItems.id })
              .from(schema.recipeItems)
              .where(eq(schema.recipeItems.materialId, vstup.id))
              .limit(1);
        if (lot || polozka) {
          throw new Error(
            "Mernú jednotku nemožno zmeniť — materiál má skladové šarže alebo je v receptúre.",
          );
        }
      }

      const [upraveny] = await tx
        .update(schema.materials)
        .set({
          code,
          name,
          unit: vstup.unit,
          category: vstup.category,
          minStockQty: vstup.minStockQty ?? null,
          note: vstup.note ?? null,
        })
        .where(eq(schema.materials.id, vstup.id))
        .returning();

      await tx.insert(schema.auditLog).values({
        tableName: "materials",
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
      throw new Error(`Materiál s kódom „${code}" už existuje.`);
    }
    throw e;
  }
}

/** Replace zoznamu predvolených dodávateľov (M2M — hard delete je OK, nie je to doklad). */
export async function nastavPredvolenychDodavatelov(
  db: DbClient,
  vstup: { userId: string; materialId: string; supplierIds: string[] },
): Promise<void> {
  return db.transaction(async (tx) => {
    await tx
      .delete(schema.materialSuppliers)
      .where(eq(schema.materialSuppliers.materialId, vstup.materialId));
    for (const supplierId of vstup.supplierIds) {
      await tx.insert(schema.materialSuppliers).values({
        materialId: vstup.materialId,
        supplierId,
        createdBy: vstup.userId,
      });
    }
  });
}

export type MaterialSoDodavatelmi = typeof schema.materials.$inferSelect & {
  predvoleniDodavatelia: string[];
};

/** Aktívne materiály podľa kódu + ids predvolených dodávateľov (pre dialóg). */
export async function listMaterials(
  db: DbClient,
): Promise<MaterialSoDodavatelmi[]> {
  const materialy = await db
    .select()
    .from(schema.materials)
    .where(isNull(schema.materials.deletedAt))
    .orderBy(asc(schema.materials.code));

  if (materialy.length === 0) return [];

  const vazby = await db
    .select()
    .from(schema.materialSuppliers)
    .where(
      inArray(
        schema.materialSuppliers.materialId,
        materialy.map((m) => m.id),
      ),
    );

  return materialy.map((m) => ({
    ...m,
    predvoleniDodavatelia: vazby
      .filter((v) => v.materialId === m.id)
      .map((v) => v.supplierId),
  }));
}

/** Guardy z návrhu: šarže na sklade alebo použitie v receptúre → zákaz mazania. */
export async function softDeleteMaterial(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [lot] = await tx
      .select({ id: schema.materialLots.id })
      .from(schema.materialLots)
      .where(eq(schema.materialLots.materialId, vstup.id))
      .limit(1);
    if (lot) {
      throw new Error(
        "Materiál nemožno zmazať — existujú k nemu skladové šarže. Doklady sa nemažú.",
      );
    }

    const [polozka] = await tx
      .select({ id: schema.recipeItems.id })
      .from(schema.recipeItems)
      .where(eq(schema.recipeItems.materialId, vstup.id))
      .limit(1);
    if (polozka) {
      throw new Error(
        "Materiál nemožno zmazať — je položkou receptúry. Najprv vytvor novú verziu receptu bez neho.",
      );
    }

    await tx
      .update(schema.materials)
      .set({ deletedAt: new Date() })
      .where(eq(schema.materials.id, vstup.id));

    await tx.insert(schema.auditLog).values({
      tableName: "materials",
      recordId: vstup.id,
      action: "delete",
      changedBy: vstup.userId,
      changes: null,
    });
  });
}
