// Test harness: PGlite (skutočný Postgres vo WASM) + reálne migrácie z ./drizzle.
// Rovnaká DB ako produkcia — testy overujú aj DB triggre/CHECK-y, nie mocky.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as schema from "@/db/schema";

export type TestDb = PgliteDatabase<typeof schema>;

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../drizzle");

/** Čerstvá in-memory DB s aplikovanými VŠETKÝMI migráciami (0000, 0001, …). */
export async function createTestDb(): Promise<{
  db: TestDb;
  client: PGlite;
}> {
  const client = new PGlite();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const chunks = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const chunk of chunks) {
      await client.exec(chunk);
    }
  }
  const db = drizzle(client, { schema });
  return { db, client };
}

/** Základné číselníky, ktoré potrebuje takmer každý integračný test. */
export async function seedZaklad(db: TestDb) {
  const adminId = "00000000-0000-0000-0000-0000000000a1";

  await db.insert(schema.users).values({
    id: adminId,
    displayName: "Test Admin",
    role: "admin",
  });

  const [stredisko] = await db
    .insert(schema.costCenters)
    .values({ code: "valcovna", name: "Valcovňa", createdBy: adminId })
    .returning();

  const [dodavatel] = await db
    .insert(schema.suppliers)
    .values({ name: "Test dodávateľ s.r.o.", createdBy: adminId })
    .returning();

  const [stroj] = await db
    .insert(schema.machines)
    .values({
      code: "VAL1",
      name: "Valcovací stroj 1",
      costCenterId: stredisko.id,
      createdBy: adminId,
    })
    .returning();

  const [pracovnik] = await db
    .insert(schema.workers)
    .values({ fullName: "Ján Testovací", createdBy: adminId })
    .returning();

  const [material] = await db
    .insert(schema.materials)
    .values({
      code: "SADZE-N330",
      name: "Sadze N330",
      unit: "kg",
      category: "plnivo",
      createdBy: adminId,
    })
    .returning();

  const [zmes] = await db
    .insert(schema.mixtures)
    .values({ code: "ZMES-A", name: "Zmes A", createdBy: adminId })
    .returning();

  const [recept] = await db
    .insert(schema.recipes)
    .values({
      mixtureId: zmes.id,
      version: 1,
      standardBatchKg: "100.000",
      createdBy: adminId,
    })
    .returning();

  await db.insert(schema.recipeItems).values({
    recipeId: recept.id,
    materialId: material.id,
    qtyKg: "50.000",
    createdBy: adminId,
  });

  return { adminId, stredisko, dodavatel, stroj, pracovnik, material, zmes, recept };
}

/** Faktúra s jednou materiálovou položkou (dokladový zdroj ceny šarže). */
export async function seedFaktura(
  db: TestDb,
  z: Awaited<ReturnType<typeof seedZaklad>>,
  opts: { cislo?: string; qty?: string; unitPrice?: string } = {},
) {
  const { cislo = "FA-2026-001", qty = "2500.000", unitPrice = "45.3500" } = opts;
  const totalNet = Math.round(Number(qty) * Number(unitPrice)); // len fixture

  const [faktura] = await db
    .insert(schema.invoices)
    .values({
      supplierId: z.dodavatel.id,
      invoiceNumber: cislo,
      dueDate: "2026-08-01",
      totalNetCents: totalNet,
      totalVatCents: 0,
      totalGrossCents: totalNet,
      createdBy: z.adminId,
    })
    .returning();

  const [polozka] = await db
    .insert(schema.invoiceItems)
    .values({
      invoiceId: faktura.id,
      description: `Materiál ${qty} kg`,
      category: "material",
      costCenterId: z.stredisko.id,
      qty,
      unit: "kg",
      unitPrice,
      totalNetCents: totalNet,
      createdBy: z.adminId,
    })
    .returning();

  return { faktura, polozka };
}

/** Rozpracovaná dávka pre testy výdaja (M4 modul má vlastnú tvorbu neskôr). */
export async function seedDavka(
  db: TestDb,
  z: Awaited<ReturnType<typeof seedZaklad>>,
  cislo = "V-2026-0001",
) {
  const [davka] = await db
    .insert(schema.productionBatches)
    .values({
      batchNumber: cislo,
      recipeId: z.recept.id,
      productionDate: "2026-07-12",
      shift: "ranna",
      machineId: z.stroj.id,
      leadWorkerId: z.pracovnik.id,
      createdBy: z.adminId,
    })
    .returning();
  return davka;
}
