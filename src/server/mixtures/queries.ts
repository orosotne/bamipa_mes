// Čítacie queries receptúr (M3). Živú kalkuláciu robí teoretickaKalkulacia
// (src/server/inventory/theoretical.ts) — volá ju priamo page.
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

export type RiadokZoznamuZmesi = {
  id: string;
  code: string;
  name: string;
  note: string | null;
  aktivnaVerzia: number | null;
  standardBatchKg: string | null;
  pocetPoloziek: number;
};

export async function zoznamZmesi(db: DbClient): Promise<RiadokZoznamuZmesi[]> {
  // Bez joinov renderuje Drizzle stĺpce nekvalifikovane — v korelovanom
  // subquery treba explicitné mixtures.id (poučenie z M2 stavSkladu).
  const riadky = await db
    .select({
      id: schema.mixtures.id,
      code: schema.mixtures.code,
      name: schema.mixtures.name,
      note: schema.mixtures.note,
      aktivnaVerzia: sql<number | null>`(
        SELECT r.version FROM recipes r
        WHERE r.mixture_id = mixtures.id AND r.is_active AND r.deleted_at IS NULL
        LIMIT 1
      )`,
      standardBatchKg: sql<string | null>`(
        SELECT r.standard_batch_kg FROM recipes r
        WHERE r.mixture_id = mixtures.id AND r.is_active AND r.deleted_at IS NULL
        LIMIT 1
      )`,
      pocetPoloziek: sql<number>`coalesce((
        SELECT count(*)::int FROM recipe_items ri
        JOIN recipes r ON r.id = ri.recipe_id
        WHERE r.mixture_id = mixtures.id AND r.is_active AND r.deleted_at IS NULL
      ), 0)`,
    })
    .from(schema.mixtures)
    .where(isNull(schema.mixtures.deletedAt))
    .orderBy(asc(schema.mixtures.code));

  return riadky;
}

export type PolozkaDetailu = {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  qtyKg: string;
  sortOrder: number;
};

export type DetailZmesi = {
  zmes: typeof schema.mixtures.$inferSelect;
  verzie: {
    id: string;
    version: number;
    isActive: boolean;
    standardBatchKg: string;
    createdAt: Date;
  }[];
  zvolena: {
    recipe: typeof schema.recipes.$inferSelect;
    polozky: PolozkaDetailu[];
  } | null;
};

/**
 * Detail zmesi s verziami (DESC) a položkami zvolenej verzie.
 * `verzia` — explicitná voľba; default = aktívna, fallback najnovšia.
 */
export async function detailZmesi(
  db: DbClient,
  mixtureId: string,
  verzia?: number,
): Promise<DetailZmesi> {
  const [zmes] = await db
    .select()
    .from(schema.mixtures)
    .where(
      and(eq(schema.mixtures.id, mixtureId), isNull(schema.mixtures.deletedAt)),
    );
  if (!zmes) throw new Error("Zmes neexistuje.");

  const verzie = await db
    .select({
      id: schema.recipes.id,
      version: schema.recipes.version,
      isActive: schema.recipes.isActive,
      standardBatchKg: schema.recipes.standardBatchKg,
      createdAt: schema.recipes.createdAt,
    })
    .from(schema.recipes)
    .where(
      and(eq(schema.recipes.mixtureId, mixtureId), isNull(schema.recipes.deletedAt)),
    )
    .orderBy(desc(schema.recipes.version));

  // Explicitná verzia, ktorá neexistuje (stale URL, ?verzia=abc → NaN),
  // padá na aktívnu — nikdy prázdny detail bez hlášky.
  const zvolenaVerzia =
    (verzia !== undefined
      ? verzie.find((v) => v.version === verzia)
      : undefined) ??
    verzie.find((v) => v.isActive) ??
    verzie[0];

  if (!zvolenaVerzia) {
    return { zmes, verzie, zvolena: null };
  }

  const [recipe] = await db
    .select()
    .from(schema.recipes)
    .where(eq(schema.recipes.id, zvolenaVerzia.id));

  const polozky = await db
    .select({
      id: schema.recipeItems.id,
      materialId: schema.recipeItems.materialId,
      materialCode: schema.materials.code,
      materialName: schema.materials.name,
      qtyKg: schema.recipeItems.qtyKg,
      sortOrder: schema.recipeItems.sortOrder,
    })
    .from(schema.recipeItems)
    .innerJoin(
      schema.materials,
      eq(schema.recipeItems.materialId, schema.materials.id),
    )
    .where(eq(schema.recipeItems.recipeId, zvolenaVerzia.id))
    .orderBy(asc(schema.recipeItems.sortOrder));

  return { zmes, verzie, zvolena: { recipe, polozky } };
}
