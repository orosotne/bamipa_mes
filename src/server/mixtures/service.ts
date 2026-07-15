// Zmesi a verzované receptúry (M3). D6: položky v kg na štandardnú dávku.
// Nemennosť verzie s dávkami drží DB trigger — úprava = nová verzia.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { sqlState } from "@/server/action-utils";

export type MixturePolia = {
  code: string;
  name: string;
  note?: string | null;
};

function validuj(polia: MixturePolia): { code: string; name: string } {
  const code = polia.code.trim();
  const name = polia.name.trim();
  if (!code) throw new Error("Kód zmesi nesmie byť prázdny.");
  if (!name) throw new Error("Názov zmesi nesmie byť prázdny.");
  return { code, name };
}

export async function createMixture(
  db: DbClient,
  vstup: { userId: string } & MixturePolia,
): Promise<typeof schema.mixtures.$inferSelect> {
  const { code, name } = validuj(vstup);
  try {
    return await db.transaction(async (tx) => {
      const [zmes] = await tx
        .insert(schema.mixtures)
        .values({ code, name, note: vstup.note ?? null, createdBy: vstup.userId })
        .returning();

      await tx.insert(schema.auditLog).values({
        tableName: "mixtures",
        recordId: zmes.id,
        action: "insert",
        changedBy: vstup.userId,
        changes: { new: { code, name } },
      });

      return zmes;
    });
  } catch (e) {
    if (sqlState(e) === "23505") {
      throw new Error(`Zmes s kódom „${code}" už existuje.`);
    }
    throw e;
  }
}

export async function updateMixture(
  db: DbClient,
  vstup: { userId: string; id: string } & MixturePolia,
): Promise<typeof schema.mixtures.$inferSelect> {
  const { code, name } = validuj(vstup);
  try {
    return await db.transaction(async (tx) => {
      const [povodna] = await tx
        .select()
        .from(schema.mixtures)
        .where(eq(schema.mixtures.id, vstup.id));
      if (!povodna) throw new Error("Zmes neexistuje.");

      const [upravena] = await tx
        .update(schema.mixtures)
        .set({ code, name, note: vstup.note ?? povodna.note })
        .where(eq(schema.mixtures.id, vstup.id))
        .returning();

      await tx.insert(schema.auditLog).values({
        tableName: "mixtures",
        recordId: vstup.id,
        action: "update",
        changedBy: vstup.userId,
        changes: { old: { code: povodna.code, name: povodna.name }, new: { code, name } },
      });

      return upravena;
    });
  } catch (e) {
    if (sqlState(e) === "23505") {
      throw new Error(`Zmes s kódom „${code}" už existuje.`);
    }
    throw e;
  }
}

/** Guard: zmes s receptami sa nemaže (recepty referencujú dávky). */
export async function softDeleteMixture(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [existujuca] = await tx
      .select({ id: schema.mixtures.id })
      .from(schema.mixtures)
      .where(
        and(eq(schema.mixtures.id, vstup.id), isNull(schema.mixtures.deletedAt)),
      );
    if (!existujuca) {
      throw new Error("Zmes neexistuje."); // žiadny falošný audit záznam
    }

    const [recept] = await tx
      .select({ id: schema.recipes.id })
      .from(schema.recipes)
      .where(eq(schema.recipes.mixtureId, vstup.id))
      .limit(1);
    if (recept) {
      throw new Error(
        "Zmes nemožno zmazať — existujú k nej receptúry. Doklady sa nemažú.",
      );
    }

    await tx
      .update(schema.mixtures)
      .set({ deletedAt: new Date() })
      .where(eq(schema.mixtures.id, vstup.id));

    await tx.insert(schema.auditLog).values({
      tableName: "mixtures",
      recordId: vstup.id,
      action: "delete",
      changedBy: vstup.userId,
      changes: null,
    });
  });
}

export type PolozkaReceptu = {
  materialId: string;
  /** numeric(12,3) string, kladné */
  qtyKg: string;
};

/**
 * Nová verzia receptúry: verzia = max+1, stáva sa aktívnou (stará aktívna sa
 * deaktivuje v tej istej transakcii). Položky len z materiálov s MJ = kg (D6).
 */
export async function createRecipeVersion(
  db: DbClient,
  vstup: {
    userId: string;
    mixtureId: string;
    standardBatchKg: string;
    techNotes?: string | null;
    polozky: PolozkaReceptu[];
  },
): Promise<typeof schema.recipes.$inferSelect> {
  if (vstup.polozky.length === 0) {
    throw new Error("Receptúra musí mať aspoň jednu položku.");
  }
  const materialIds = vstup.polozky.map((p) => p.materialId);
  if (new Set(materialIds).size !== materialIds.length) {
    throw new Error("Duplicitný materiál v položkách — každý materiál len raz.");
  }

  try {
    return await db.transaction(async (tx) => {
    // Zmes musí existovať a nesmie byť zmazaná (stale URL / druhý tab).
    const [zmes] = await tx
      .select({ id: schema.mixtures.id })
      .from(schema.mixtures)
      .where(
        and(
          eq(schema.mixtures.id, vstup.mixtureId),
          isNull(schema.mixtures.deletedAt),
        ),
      );
    if (!zmes) {
      throw new Error("Zmes neexistuje alebo je zmazaná.");
    }

    // Guard D6: všetky materiály musia mať MJ = kg (a byť živé).
    const materialy = await tx
      .select({
        id: schema.materials.id,
        code: schema.materials.code,
        unit: schema.materials.unit,
      })
      .from(schema.materials)
      .where(
        and(
          inArray(schema.materials.id, materialIds),
          isNull(schema.materials.deletedAt),
        ),
      );
    if (materialy.length !== materialIds.length) {
      throw new Error("Niektorý materiál neexistuje.");
    }
    const zlaMj = materialy.find((m) => m.unit !== "kg");
    if (zlaMj) {
      throw new Error(
        `Materiál ${zlaMj.code} má MJ „${zlaMj.unit}" — receptúry sú v kg (D6). Použi materiál vedený v kg.`,
      );
    }

    const [posledna] = await tx
      .select({ version: schema.recipes.version })
      .from(schema.recipes)
      .where(eq(schema.recipes.mixtureId, vstup.mixtureId))
      .orderBy(desc(schema.recipes.version))
      .limit(1);
    const verzia = (posledna?.version ?? 0) + 1;

    // Deaktivuj doterajšiu aktívnu (partial unique povolí max 1 aktívnu).
    await tx
      .update(schema.recipes)
      .set({ isActive: false })
      .where(
        and(
          eq(schema.recipes.mixtureId, vstup.mixtureId),
          eq(schema.recipes.isActive, true),
          isNull(schema.recipes.deletedAt),
        ),
      );

    const [recept] = await tx
      .insert(schema.recipes)
      .values({
        mixtureId: vstup.mixtureId,
        version: verzia,
        standardBatchKg: vstup.standardBatchKg,
        techNotes: vstup.techNotes ?? null,
        isActive: true,
        createdBy: vstup.userId,
      })
      .returning();

    for (const [index, polozka] of vstup.polozky.entries()) {
      await tx.insert(schema.recipeItems).values({
        recipeId: recept.id,
        materialId: polozka.materialId,
        qtyKg: polozka.qtyKg,
        sortOrder: index,
        createdBy: vstup.userId,
      });
    }

    await tx.insert(schema.auditLog).values({
      tableName: "recipes",
      recordId: recept.id,
      action: "insert",
      changedBy: vstup.userId,
      changes: { new: { version: verzia, polozky: vstup.polozky.length } },
    });

    return recept;
    });
  } catch (e) {
    if (sqlState(e) === "23505") {
      throw new Error(
        "Receptúru práve zmenil iný používateľ — obnov stránku a skús znova.",
      );
    }
    throw e;
  }
}

/** Prepne aktívnu verziu zmesi na zadanú (návrat k staršej verzii). */
export async function aktivujVerziu(
  db: DbClient,
  vstup: { userId: string; recipeId: string },
): Promise<void> {
  try {
    return await db.transaction(async (tx) => {
    const [recept] = await tx
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.id, vstup.recipeId));
    if (!recept) throw new Error("Verzia receptúry neexistuje.");
    if (recept.isActive) return; // už je aktívna

    await tx
      .update(schema.recipes)
      .set({ isActive: false })
      .where(
        and(
          eq(schema.recipes.mixtureId, recept.mixtureId),
          eq(schema.recipes.isActive, true),
          isNull(schema.recipes.deletedAt),
        ),
      );
    await tx
      .update(schema.recipes)
      .set({ isActive: true })
      .where(eq(schema.recipes.id, vstup.recipeId));

    await tx.insert(schema.auditLog).values({
      tableName: "recipes",
      recordId: vstup.recipeId,
      action: "status_change",
      changedBy: vstup.userId,
      changes: { new: { isActive: true, version: recept.version } },
    });
    });
  } catch (e) {
    if (sqlState(e) === "23505") {
      throw new Error(
        "Receptúru práve zmenil iný používateľ — obnov stránku a skús znova.",
      );
    }
    throw e;
  }
}
