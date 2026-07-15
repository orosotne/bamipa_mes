// Testovacie fixtures pre modul Labák (M5). Súbor NIE JE *.test.ts → vitest ho
// nespúšťa; zdieľajú ho service.test.ts aj queries.test.ts. createTestDb aplikuje
// len migrácie (schéma + triggre) bez seed dát — lab_parameters preto seedujeme tu.
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { odovzdajNaLabak } from "@/server/batches/service";
import { seedDavka, type seedZaklad, type TestDb } from "@/test/pglite";

// 7 QC parametrov zo SPEC M5 (zhodné so seedZakladneCiselniky).
const PARAMETRE = [
  { code: "ML", name: "Minimálny krútiaci moment (ML)", unit: "dNm", sortOrder: 1 },
  { code: "MH", name: "Maximálny krútiaci moment (MH)", unit: "dNm", sortOrder: 2 },
  { code: "TS2", name: "Čas navulkanizácie (ts2)", unit: "min", sortOrder: 3 },
  { code: "T90", name: "Optimum vulkanizácie (t90)", unit: "min", sortOrder: 4 },
  { code: "PEVNOST", name: "Pevnosť v ťahu", unit: "MPa", sortOrder: 5 },
  { code: "TAZNOST", name: "Ťažnosť", unit: "%", sortOrder: 6 },
  { code: "TVRDOST", name: "Tvrdosť", unit: "ShA", sortOrder: 7 },
];

export type LabParametreMapa = Record<
  string,
  typeof schema.labParameters.$inferSelect
>;

/** Seedne 7 QC parametrov, vráti mapu podľa kódu. */
export async function seedLabParametre(
  db: DbClient,
  adminId: string,
): Promise<LabParametreMapa> {
  const mapa: LabParametreMapa = {};
  for (const p of PARAMETRE) {
    const [row] = await db
      .insert(schema.labParameters)
      .values({ ...p, createdBy: adminId })
      .returning();
    mapa[p.code] = row;
  }
  return mapa;
}

/** Definuje tolerančné limity per zmes (lab_test_definitions). */
export async function seedLimity(
  db: DbClient,
  opts: {
    adminId: string;
    mixtureId: string;
    parametre: LabParametreMapa;
    limity: { code: string; min?: string | null; max?: string | null }[];
  },
): Promise<void> {
  for (const l of opts.limity) {
    const param = opts.parametre[l.code];
    if (!param) throw new Error(`Neznámy parameter v seedLimity: ${l.code}`);
    await db.insert(schema.labTestDefinitions).values({
      mixtureId: opts.mixtureId,
      parameterId: param.id,
      minValue: l.min ?? null,
      maxValue: l.max ?? null,
      createdBy: opts.adminId,
    });
  }
}

/** Založí dávku a odovzdá ju na labák (stav caka_na_labak). */
export async function pripravDavkuNaLabak(
  db: TestDb,
  zaklad: Awaited<ReturnType<typeof seedZaklad>>,
  opts: { cislo?: string; outputKg?: string } = {},
): Promise<typeof schema.productionBatches.$inferSelect> {
  const davka = await seedDavka(db, zaklad, opts.cislo);
  return odovzdajNaLabak(db, {
    userId: zaklad.adminId,
    batchId: davka.id,
    outputKg: opts.outputKg ?? "100.000",
  });
}

/** Laborant (created_by pre merania) — seedZaklad tvorí len admina. */
export async function seedLaborant(
  db: DbClient,
  adminId: string,
  id = "00000000-0000-0000-0000-0000000000b1",
): Promise<typeof schema.users.$inferSelect> {
  const [laborant] = await db
    .insert(schema.users)
    .values({
      id,
      displayName: "Laborantka Eva",
      role: "laborant",
      createdBy: adminId,
    })
    .returning();
  return laborant;
}
