// Testovacie fixtures pre modul Lisovňa (M6). Súbor NIE JE *.test.ts → vitest
// ho nespúšťa; zdieľajú ho testy služieb aj queries. Schválená dávka sa vyrába
// PLNÝM tokom M4+M5 (odovzdanie na labák → meranie → verdikt) — fixtures tak
// zároveň overujú integráciu s QC bránou namiesto ručného ohýbania stavov.
import { eq } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { odovzdajNaLabak } from "@/server/batches/service";
import {
  seedLabParametre,
  seedLimity,
  type LabParametreMapa,
} from "@/server/lab/fixtures";
import { vynesVerdikt, zapisMerania } from "@/server/lab/service";
import { type seedZaklad, type TestDb } from "@/test/pglite";

export type Zaklad = Awaited<ReturnType<typeof seedZaklad>>;

export type LisovnaZaklad = {
  lisovna: typeof schema.costCenters.$inferSelect;
  lis: typeof schema.machines.$inferSelect;
  dovod: typeof schema.defectReasons.$inferSelect;
  prestojDovod: typeof schema.downtimeReasons.$inferSelect;
  artikel: typeof schema.soleModels.$inferSelect;
  parametre: LabParametreMapa;
};

/**
 * Lisovňa základ: stredisko lisovna + lis LIS1, číselníky (nepodarok, prestoj),
 * artikel na ZMES-A a QC parametre s limitom TVRDOST (pre schvaľovanie dávok).
 */
export async function seedLisovnaZaklad(
  db: TestDb,
  z: Zaklad,
): Promise<LisovnaZaklad> {
  const [lisovna] = await db
    .insert(schema.costCenters)
    .values({ code: "lisovna", name: "Lisovňa", createdBy: z.adminId })
    .returning();

  const [lis] = await db
    .insert(schema.machines)
    .values({
      code: "LIS1",
      name: "Lis 1",
      costCenterId: lisovna.id,
      createdBy: z.adminId,
    })
    .returning();

  const [dovod] = await db
    .insert(schema.defectReasons)
    .values({ code: "bublina", name: "Bublina", createdBy: z.adminId })
    .returning();

  const [prestojDovod] = await db
    .insert(schema.downtimeReasons)
    .values({ code: "porucha", name: "Porucha stroja", createdBy: z.adminId })
    .returning();

  const [artikel] = await db
    .insert(schema.soleModels)
    .values({
      code: "POD-100",
      name: "Podošva Trek 100",
      mixtureId: z.zmes.id,
      mixtureKgPerPair: "0.850",
      createdBy: z.adminId,
    })
    .returning();

  const parametre = await seedLabParametre(db, z.adminId);
  await seedLimity(db, {
    adminId: z.adminId,
    mixtureId: z.zmes.id,
    parametre,
    limity: [{ code: "TVRDOST", min: "50", max: "70" }],
  });

  return { lisovna, lis, dovod, prestojDovod, artikel, parametre };
}

/**
 * Dávka na danom recepte prevedená plným tokom do stavu 'schvalena'
 * (odovzdanie na labák → meranie TVRDOST v limite → verdikt SCHVÁLENÉ).
 * Zmes receptu musí mať limit pre daný parameter.
 */
export async function pripravSchvalenuDavkuNaRecept(
  db: TestDb,
  z: Zaklad,
  opts: {
    receptId: string;
    parameterId: string;
    cislo: string;
    outputKg?: string;
  },
): Promise<typeof schema.productionBatches.$inferSelect> {
  const [davka] = await db
    .insert(schema.productionBatches)
    .values({
      batchNumber: opts.cislo,
      recipeId: opts.receptId,
      productionDate: "2026-07-14",
      shift: "ranna",
      machineId: z.stroj.id,
      leadWorkerId: z.pracovnik.id,
      createdBy: z.adminId,
    })
    .returning();

  await odovzdajNaLabak(db, {
    userId: z.adminId,
    batchId: davka.id,
    outputKg: opts.outputKg ?? "100.000",
  });
  const { test } = await zapisMerania(db, {
    userId: z.adminId,
    batchId: davka.id,
    merania: [{ parameterId: opts.parameterId, value: "60" }],
  });
  await vynesVerdikt(db, {
    userId: z.adminId,
    labTestId: test.id,
    verdict: "schvalene",
  });

  const [po] = await db
    .select()
    .from(schema.productionBatches)
    .where(eq(schema.productionBatches.id, davka.id));
  return po;
}

/** Schválená dávka ZMES-A (recept zo seedZaklad). */
export async function pripravSchvalenuDavku(
  db: TestDb,
  z: Zaklad,
  lz: LisovnaZaklad,
  opts: { cislo?: string; outputKg?: string } = {},
): Promise<typeof schema.productionBatches.$inferSelect> {
  return pripravSchvalenuDavkuNaRecept(db, z, {
    receptId: z.recept.id,
    parameterId: lz.parametre["TVRDOST"].id,
    cislo: opts.cislo ?? "V-2026-0001",
    outputKg: opts.outputKg,
  });
}

/** Druhá zmes (ZMES-B) s receptom a limitom — na testy nesúladu zmesi. */
export async function seedZmesB(db: DbClient, z: Zaklad, lz: LisovnaZaklad) {
  const [zmesB] = await db
    .insert(schema.mixtures)
    .values({ code: "ZMES-B", name: "Zmes B", createdBy: z.adminId })
    .returning();
  const [receptB] = await db
    .insert(schema.recipes)
    .values({
      mixtureId: zmesB.id,
      version: 1,
      standardBatchKg: "100.000",
      createdBy: z.adminId,
    })
    .returning();
  await seedLimity(db, {
    adminId: z.adminId,
    mixtureId: zmesB.id,
    parametre: lz.parametre,
    limity: [{ code: "TVRDOST", min: "50", max: "70" }],
  });
  return { zmesB, receptB };
}
