// Zámok uzavretého obdobia (M7, 0007) — TDD PRED implementáciou triggrov.
// SPEC M7: po uzávierke sa doklady obdobia nemenia. „Over aj cez API" (§12):
// testy útočia priamymi INSERT/UPDATE mimo služieb — zastaviť ich musí DB.
// Nákladovo neutrálne operácie (QC verdikt, poznámky, platby faktúr, júlové
// doklady) musia prechádzať aj po uzávierke júna.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { vynesVerdikt, zapisMerania } from "@/server/lab/service";
import { vydajNavazky } from "@/server/inventory/issue";
import {
  seedLisovnaZaklad,
  type LisovnaZaklad,
  type Zaklad,
} from "@/server/press/fixtures";
import { stornoVykon, zapisVykon } from "@/server/press/runs";
import { zapisOrez } from "@/server/press/scrap";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { uzavriMesiac } from "./close";
import {
  plnaHlaska,
  pripravDavkuSNakladmi,
  seedKalkulacieZaklad,
  seedLisovnaJun,
  seedRezijnaFaktura,
  seedRezijneFakturyJun,
  seedVyrobaJun,
  type KalkZaklad,
  type LisovnaJun,
  type VyrobaJun,
} from "./fixtures";

/** DB zámok obdobia hlási „… je uzavretý — … nemožno meniť" (aj cez cause). */
const jeZamknute = (e: unknown) => plnaHlaska(e).includes("uzavretý");

const DNES = "2026-07-16";

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;
let kz: KalkZaklad;
let vyroba: VyrobaJun;
let lisovna: LisovnaJun;
/** Júnová dávka odovzdaná na labák bez verdiktu (QC dobehne po uzávierke). */
let d4: typeof schema.productionBatches.$inferSelect;

beforeEach(async () => {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
  kz = await seedKalkulacieZaklad(db, z);
  await seedRezijneFakturyJun(db, z, lz, kz);
  vyroba = await seedVyrobaJun(db, z, lz);
  lisovna = await seedLisovnaJun(db, z, lz, kz, vyroba);
  d4 = await pripravDavkuSNakladmi(db, z, lz, {
    cislo: "V-2026-0103",
    productionDate: "2026-06-26",
    vydajKg: "5.000",
    pracaHodiny: "1.00",
    pracaSadzbaCents: 100,
    outputKg: "10.000",
    schvalit: false,
  });
  await uzavriMesiac(db, {
    period: "2026-06-01",
    userId: z.adminId,
    dnes: DNES,
  });
});

async function junovyVykon() {
  const [run] = await db
    .select()
    .from(schema.pressRuns)
    .where(eq(schema.pressRuns.workOrderId, lisovna.prikaz.id))
    .orderBy(schema.pressRuns.runDate)
    .limit(1);
  return run;
}

describe("zámok skladu a dávok", () => {
  test("výdaj na dávku uzavretého mesiaca zastaví DB (aj cez službu)", async () => {
    await expect(
      vydajNavazky(db, {
        userId: z.adminId,
        batchId: vyroba.d1.id,
        materialId: z.material.id,
        qty: "1.000",
      }),
    ).rejects.toSatisfy(jeZamknute);
  });

  test("nákladové polia dávky sú zamknuté; poznámka a QC verdikt prejdú", async () => {
    // output_kg schválenej dávky chráni už M6 guard (rozpočet lisovne) —
    // zámok obdobia sa overuje na dávke „čaká na labák" (d4).
    await expect(
      db
        .update(schema.productionBatches)
        .set({ outputKg: "120.000" })
        .where(eq(schema.productionBatches.id, d4.id)),
    ).rejects.toSatisfy(jeZamknute);

    await db
      .update(schema.productionBatches)
      .set({ note: "doplnená poznámka" })
      .where(eq(schema.productionBatches.id, vyroba.d1.id));

    // Verdikt labáku po uzávierke: mení len status (nie náklady) → povolené.
    const { test: meranie } = await zapisMerania(db, {
      userId: z.adminId,
      batchId: d4.id,
      merania: [{ parameterId: lz.parametre["TVRDOST"].id, value: "60" }],
    });
    await vynesVerdikt(db, {
      userId: z.adminId,
      labTestId: meranie.id,
      verdict: "schvalene",
    });
    const [poVerdikte] = await db
      .select()
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.id, d4.id));
    expect(poVerdikte.status).toBe("schvalena");
  });

  test("soft delete dávky uzavretého mesiaca padne", async () => {
    await expect(
      db
        .update(schema.productionBatches)
        .set({ deletedAt: new Date() })
        .where(eq(schema.productionBatches.id, d4.id)),
    ).rejects.toSatisfy(jeZamknute);
  });

  test("antedatovaná dávka do uzavretého mesiaca padne", async () => {
    await expect(
      db.insert(schema.productionBatches).values({
        batchNumber: "V-2026-0666",
        recipeId: z.recept.id,
        productionDate: "2026-06-29",
        shift: "ranna",
        machineId: z.stroj.id,
        leadWorkerId: z.pracovnik.id,
        createdBy: z.adminId,
      }),
    ).rejects.toSatisfy(jeZamknute);
  });

  test("práca dávky uzavretého mesiaca: INSERT, UPDATE aj tombstone padnú", async () => {
    await expect(
      db.insert(schema.batchLabor).values({
        batchId: vyroba.d1.id,
        workerId: z.pracovnik.id,
        workDate: "2026-07-02",
        hours: "1.00",
        hourlyRateCents: 1000,
        createdBy: z.adminId,
      }),
    ).rejects.toSatisfy(jeZamknute);

    const [praca] = await db
      .select()
      .from(schema.batchLabor)
      .where(eq(schema.batchLabor.batchId, vyroba.d1.id));
    await expect(
      db
        .update(schema.batchLabor)
        .set({ hours: "9.99" })
        .where(eq(schema.batchLabor.id, praca.id)),
    ).rejects.toSatisfy(jeZamknute);
    await expect(
      db
        .update(schema.batchLabor)
        .set({ deletedAt: new Date() })
        .where(eq(schema.batchLabor.id, praca.id)),
    ).rejects.toSatisfy(jeZamknute);
  });
});

describe("zámok lisovne", () => {
  test("výkon s run_date v uzavretom mesiaci padne; storno júnového výkonu padne", async () => {
    await expect(
      zapisVykon(db, {
        userId: z.adminId,
        workOrderId: lisovna.prikaz.id,
        machineId: lz.lis.id,
        batchId: vyroba.d1.id,
        runDate: "2026-06-29",
        shift: "ranna",
        cyclesCount: 1,
        pairsProduced: 0,
        mixtureKg: "1.000",
        workerId: z.pracovnik.id,
      }),
    ).rejects.toSatisfy(jeZamknute);

    const run = await junovyVykon();
    await expect(
      stornoVykon(db, { userId: z.adminId, id: run.id }),
    ).rejects.toSatisfy(jeZamknute);
  });

  test("nepodarky júnového výkonu nemožno meniť", async () => {
    const run = await junovyVykon();
    const [nepodarok] = await db
      .select()
      .from(schema.pressRunDefects)
      .where(eq(schema.pressRunDefects.pressRunId, run.id));
    await expect(
      db
        .update(schema.pressRunDefects)
        .set({ qtyPairs: 99 })
        .where(eq(schema.pressRunDefects.id, nepodarok.id)),
    ).rejects.toSatisfy(jeZamknute);
  });

  test("práca lisovne a orez s dátumom v uzavretom mesiaci padnú", async () => {
    await expect(
      db.insert(schema.workOrderLabor).values({
        workOrderId: lisovna.prikaz.id,
        workerId: z.pracovnik.id,
        workDate: "2026-06-30",
        hours: "1.00",
        hourlyRateCents: 900,
        createdBy: z.adminId,
      }),
    ).rejects.toSatisfy(jeZamknute);

    await expect(
      zapisOrez(db, {
        userId: z.adminId,
        workOrderId: lisovna.prikaz.id,
        qtyKg: "1.000",
        recordDate: "2026-06-30",
      }),
    ).rejects.toSatisfy(jeZamknute);
  });
});

describe("zámok faktúr a korekčných položiek", () => {
  async function junovaFaktura() {
    const [f] = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.invoiceNumber, "FA-REZIE-2026-06"));
    return f;
  }

  test("položky a sumy júnovej faktúry sú zamknuté", async () => {
    const f = await junovaFaktura();
    const [polozka] = await db
      .select()
      .from(schema.invoiceItems)
      .where(eq(schema.invoiceItems.invoiceId, f.id));

    await expect(
      db
        .update(schema.invoiceItems)
        .set({ totalNetCents: 1 })
        .where(eq(schema.invoiceItems.id, polozka.id)),
    ).rejects.toSatisfy(jeZamknute);

    await expect(
      db.insert(schema.invoiceItems).values({
        invoiceId: f.id,
        description: "dodatočná réžia",
        category: "rezia",
        costCenterId: z.stredisko.id,
        totalNetCents: 1000,
        createdBy: z.adminId,
      }),
    ).rejects.toSatisfy(jeZamknute);

    await expect(
      db
        .update(schema.invoices)
        .set({ totalNetCents: 1, totalGrossCents: 1 })
        .where(eq(schema.invoices.id, f.id)),
    ).rejects.toSatisfy(jeZamknute);
  });

  test("status faktúry a platby ostávajú voľné (cash-flow nie je náklad)", async () => {
    const f = await junovaFaktura();
    await db
      .update(schema.invoices)
      .set({ status: "schvalena" })
      .where(eq(schema.invoices.id, f.id));
    await db.insert(schema.invoicePayments).values({
      invoiceId: f.id,
      paidAt: "2026-07-10",
      amountCents: 100000,
      createdBy: z.adminId,
    });
  });

  test("doklad do NEuzavretého mesiaca pod hranicou poslednej uzávierky padne (medzera — review nález)", async () => {
    // Máj nikdy nebol uzavretý, ale jún už áno → májový doklad by rozbil
    // carry-forward reťaz. Oneskorená faktúra patrí do aktuálneho obdobia.
    await expect(
      seedRezijnaFaktura(db, z, {
        cislo: "FA-NESKORA-2026-05",
        deliveryDate: "2026-05-20",
        polozky: [
          { category: "rezia", costCenterId: z.stredisko.id, totalNetCents: 5000 },
        ],
      }),
    ).rejects.toSatisfy(jeZamknute);
  });

  test("korekčná položka do uzavretého mesiaca padne, do otvoreného prejde", async () => {
    await expect(
      db.insert(schema.costCorrections).values({
        lotId: vyroba.lot.id,
        costCenterId: z.stredisko.id,
        periodDate: "2026-06-01",
        amountCents: 100,
        createdBy: z.adminId,
      }),
    ).rejects.toSatisfy(jeZamknute);

    await db.insert(schema.costCorrections).values({
      lotId: vyroba.lot.id,
      costCenterId: z.stredisko.id,
      periodDate: "2026-07-01",
      amountCents: 100,
      createdBy: z.adminId,
    });
  });
});

describe("otvorený mesiac žije normálne", () => {
  test("júlová dávka plným tokom aj júlový výkon na júnovú schválenú dávku prejdú", async () => {
    const d5 = await pripravDavkuSNakladmi(db, z, lz, {
      cislo: "V-2026-0201",
      productionDate: "2026-07-05",
      vydajKg: "2.000",
      pracaHodiny: "1.00",
      pracaSadzbaCents: 1000,
      outputKg: "20.000",
    });
    expect(d5.status).toBe("schvalena");

    // Zmes vyrobená v júni, lisovaná v júli — run_date júl je otvorený.
    const { run } = await zapisVykon(db, {
      userId: z.adminId,
      workOrderId: lisovna.prikaz.id,
      machineId: lz.lis.id,
      batchId: vyroba.d1.id,
      runDate: "2026-07-06",
      shift: "ranna",
      cyclesCount: 10,
      pairsProduced: 20,
      mixtureKg: "5.000",
      workerId: z.pracovnik.id,
    });
    expect(run.id).toBeDefined();
  });
});
