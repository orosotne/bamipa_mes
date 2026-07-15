// Výkony lisovania — jadro M6. Testuje tvrdú väzbu na schválené dávky
// (SPEC §12: „over aj cez API" → obchádzanie služby priamym INSERTom musí
// zastaviť DB trigger), rozpočet kg dávky, zhodu zmesi a storno.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  pripravSchvalenuDavku,
  pripravSchvalenuDavkuNaRecept,
  seedLisovnaZaklad,
  seedZmesB,
  type LisovnaZaklad,
  type Zaklad,
} from "./fixtures";
import { dokonciPrikaz, otvorPrikaz, zalozPrikaz } from "./orders";
import { stornoVykon, zapisVykon } from "./runs";

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;

beforeEach(async () => {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
});

async function novyPrikaz(qty = 500) {
  return zalozPrikaz(db, {
    userId: z.adminId,
    soleModelId: lz.artikel.id,
    qtyPairsPlanned: qty,
  });
}

function vykonVstup(prikazId: string, davkaId: string) {
  return {
    userId: z.adminId,
    workOrderId: prikazId,
    machineId: lz.lis.id,
    batchId: davkaId,
    runDate: "2026-07-15",
    shift: "ranna",
    cyclesCount: 120,
    pairsProduced: 230,
    mixtureKg: "60.000",
    workerId: z.pracovnik.id,
  };
}

describe("zapisVykon", () => {
  test("zapíše výkon s nepodarkami a prestojmi, príkaz prejde nova → vo_vyrobe", async () => {
    const prikaz = await novyPrikaz();
    const davka = await pripravSchvalenuDavku(db, z, lz);

    const { run, defects, downtimes } = await zapisVykon(db, {
      ...vykonVstup(prikaz.id, davka.id),
      nepodarky: [{ defectReasonId: lz.dovod.id, qtyPairs: 7 }],
      prestoje: [{ reasonId: lz.prestojDovod.id, minutes: 25, note: "výmena formy" }],
    });

    expect(run.cyclesCount).toBe(120);
    expect(run.pairsProduced).toBe(230);
    expect(defects).toHaveLength(1);
    expect(defects[0].qtyPairs).toBe(7);
    expect(downtimes).toHaveLength(1);

    const [poPrikaz] = await db
      .select()
      .from(schema.workOrders)
      .where(eq(schema.workOrders.id, prikaz.id));
    expect(poPrikaz.status).toBe("vo_vyrobe");
  });

  test("neschválenú dávku odmietne (cez službu)", async () => {
    const prikaz = await novyPrikaz();
    // dávka len založená (rozpracovana) — nie schválená
    const [davka] = await db
      .insert(schema.productionBatches)
      .values({
        batchNumber: "V-2026-0077",
        recipeId: z.recept.id,
        productionDate: "2026-07-14",
        shift: "ranna",
        machineId: z.stroj.id,
        leadWorkerId: z.pracovnik.id,
        createdBy: z.adminId,
      })
      .returning();

    await expect(
      zapisVykon(db, vykonVstup(prikaz.id, davka.id)),
    ).rejects.toSatisfy((e) =>
      plnaHlaska(e).includes("nie je schválená labákom"),
    );
  });

  test("TVRDÁ VÄZBA §12: priamy INSERT mimo služby zastaví DB trigger", async () => {
    const prikaz = await novyPrikaz();
    const [davka] = await db
      .insert(schema.productionBatches)
      .values({
        batchNumber: "V-2026-0078",
        recipeId: z.recept.id,
        productionDate: "2026-07-14",
        shift: "ranna",
        machineId: z.stroj.id,
        leadWorkerId: z.pracovnik.id,
        createdBy: z.adminId,
      })
      .returning();

    await expect(
      db.insert(schema.pressRuns).values({
        workOrderId: prikaz.id,
        machineId: lz.lis.id,
        batchId: davka.id,
        runDate: "2026-07-15",
        shift: "ranna",
        cyclesCount: 10,
        pairsProduced: 20,
        mixtureKg: "5.000",
        workerId: z.pracovnik.id,
        createdBy: z.adminId,
      }),
    ).rejects.toSatisfy((e) =>
      plnaHlaska(e).includes("nie je schválená labákom"),
    );
  });

  test("dávku z inej zmesi než artikel odmietne", async () => {
    const prikaz = await novyPrikaz();
    const { receptB } = await seedZmesB(db, z, lz);
    const davkaB = await pripravSchvalenuDavkuNaRecept(db, z, {
      receptId: receptB.id,
      parameterId: lz.parametre["TVRDOST"].id,
      cislo: "V-2026-0080",
    });

    await expect(
      zapisVykon(db, vykonVstup(prikaz.id, davkaB.id)),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("inej zmesi"));
  });

  test("rozpočet dávky: spotreba nad output_kg je odmietnutá", async () => {
    const prikaz = await novyPrikaz();
    const davka = await pripravSchvalenuDavku(db, z, lz, {
      outputKg: "100.000",
    });

    await zapisVykon(db, {
      ...vykonVstup(prikaz.id, davka.id),
      mixtureKg: "60.000",
    });
    await expect(
      zapisVykon(db, { ...vykonVstup(prikaz.id, davka.id), mixtureKg: "50.000" }),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("Prekročený zostatok"));
  });

  test("stroj mimo strediska lisovna je odmietnutý", async () => {
    const prikaz = await novyPrikaz();
    const davka = await pripravSchvalenuDavku(db, z, lz);

    await expect(
      zapisVykon(db, {
        ...vykonVstup(prikaz.id, davka.id),
        machineId: z.stroj.id, // valcovací stroj
      }),
    ).rejects.toThrow(/strediska lisovňa/);
  });

  test("duplicitný dôvod nepodarku v jednom výkone je odmietnutý", async () => {
    const prikaz = await novyPrikaz();
    const davka = await pripravSchvalenuDavku(db, z, lz);

    await expect(
      zapisVykon(db, {
        ...vykonVstup(prikaz.id, davka.id),
        nepodarky: [
          { defectReasonId: lz.dovod.id, qtyPairs: 2 },
          { defectReasonId: lz.dovod.id, qtyPairs: 3 },
        ],
      }),
    ).rejects.toThrow(/opakuje/);
  });

  test("na dokončený príkaz nejde zapísať výkon", async () => {
    const prikaz = await novyPrikaz();
    const davka = await pripravSchvalenuDavku(db, z, lz);
    await zapisVykon(db, vykonVstup(prikaz.id, davka.id));
    await dokonciPrikaz(db, { userId: z.adminId, id: prikaz.id });

    await expect(
      zapisVykon(db, vykonVstup(prikaz.id, davka.id)),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("dokoncena"));

    // reopen umožní opravy
    await otvorPrikaz(db, { userId: z.adminId, id: prikaz.id });
    const druhy = await zapisVykon(db, {
      ...vykonVstup(prikaz.id, davka.id),
      mixtureKg: "10.000",
    });
    expect(druhy.run.id).toBeTruthy();
  });
});

describe("nemennosť a storno výkonu", () => {
  test("hard DELETE výkonu zastaví DB trigger", async () => {
    const prikaz = await novyPrikaz();
    const davka = await pripravSchvalenuDavku(db, z, lz);
    const { run } = await zapisVykon(db, vykonVstup(prikaz.id, davka.id));

    await expect(
      db.delete(schema.pressRuns).where(eq(schema.pressRuns.id, run.id)),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("nemožno mazať"));
  });

  test("zmena batch_id výkonu zastaví DB trigger (immutabilná väzba)", async () => {
    const prikaz = await novyPrikaz();
    const davka = await pripravSchvalenuDavku(db, z, lz);
    const davka2 = await pripravSchvalenuDavku(db, z, lz, {
      cislo: "V-2026-0002",
    });
    const { run } = await zapisVykon(db, vykonVstup(prikaz.id, davka.id));

    await expect(
      db
        .update(schema.pressRuns)
        .set({ batchId: davka2.id })
        .where(eq(schema.pressRuns.id, run.id)),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("nemenná"));
  });

  test("storno uvoľní rozpočet dávky a zneplatní deti", async () => {
    const prikaz = await novyPrikaz();
    const davka = await pripravSchvalenuDavku(db, z, lz, {
      outputKg: "100.000",
    });
    const { run } = await zapisVykon(db, {
      ...vykonVstup(prikaz.id, davka.id),
      mixtureKg: "80.000",
      nepodarky: [{ defectReasonId: lz.dovod.id, qtyPairs: 2 }],
    });

    await stornoVykon(db, { userId: z.adminId, id: run.id });

    const [poRun] = await db
      .select()
      .from(schema.pressRuns)
      .where(eq(schema.pressRuns.id, run.id));
    expect(poRun.deletedAt).not.toBeNull();

    const deti = await db
      .select()
      .from(schema.pressRunDefects)
      .where(eq(schema.pressRunDefects.pressRunId, run.id));
    expect(deti.every((d) => d.deletedAt !== null)).toBe(true);

    // rozpočet 100 kg je opäť voľný
    const druhy = await zapisVykon(db, {
      ...vykonVstup(prikaz.id, davka.id),
      mixtureKg: "100.000",
    });
    expect(druhy.run.mixtureKg).toBe("100.000");
  });

  test("na zmazaný príkaz nejde INSERT výkonu (DB trigger, defense-in-depth)", async () => {
    const prikaz = await novyPrikaz();
    const davka = await pripravSchvalenuDavku(db, z, lz);
    await db
      .update(schema.workOrders)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workOrders.id, prikaz.id));

    await expect(
      db.insert(schema.pressRuns).values({
        workOrderId: prikaz.id,
        machineId: lz.lis.id,
        batchId: davka.id,
        runDate: "2026-07-15",
        shift: "ranna",
        cyclesCount: 10,
        pairsProduced: 20,
        mixtureKg: "5.000",
        workerId: z.pracovnik.id,
        createdBy: z.adminId,
      }),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("zmazaný"));
  });

  test("na stornovaný výkon nejde pridať nepodarok (DB trigger)", async () => {
    const prikaz = await novyPrikaz();
    const davka = await pripravSchvalenuDavku(db, z, lz);
    const { run } = await zapisVykon(db, vykonVstup(prikaz.id, davka.id));
    await stornoVykon(db, { userId: z.adminId, id: run.id });

    await expect(
      db.insert(schema.pressRunDefects).values({
        pressRunId: run.id,
        defectReasonId: lz.dovod.id,
        qtyPairs: 1,
        createdBy: z.adminId,
      }),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("stornovaný"));
  });

  test("soft delete schválenej dávky so živými výkonmi zastaví DB trigger", async () => {
    const prikaz = await novyPrikaz();
    const davka = await pripravSchvalenuDavku(db, z, lz);
    await zapisVykon(db, vykonVstup(prikaz.id, davka.id));

    await expect(
      db
        .update(schema.productionBatches)
        .set({ deletedAt: new Date() })
        .where(eq(schema.productionBatches.id, davka.id)),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("nemožno zmazať"));
  });

  test("storno výkonu pod už expedované množstvo zastaví DB trigger", async () => {
    const prikaz = await novyPrikaz();
    const davka = await pripravSchvalenuDavku(db, z, lz);
    const { run } = await zapisVykon(db, vykonVstup(prikaz.id, davka.id)); // 230 párov

    // expedícia 100 párov priamym zápisom (shipments služba je testovaná zvlášť)
    const [dl] = await db
      .insert(schema.shipments)
      .values({
        shipmentNumber: "DL-2026-0001",
        shipDate: "2026-07-15",
        customer: "LOWA",
        createdBy: z.adminId,
      })
      .returning();
    await db.insert(schema.shipmentItems).values({
      shipmentId: dl.id,
      workOrderId: prikaz.id,
      qtyPairs: 100,
      createdBy: z.adminId,
    });

    await expect(
      stornoVykon(db, { userId: z.adminId, id: run.id }),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("expedované"));
  });
});

/** Spojí message reťazec chyby vrátane cause (DrizzleQueryError balí PG chybu). */
function plnaHlaska(e: unknown): string {
  const casti: string[] = [];
  let cur = e as { message?: string; cause?: unknown } | undefined;
  while (cur) {
    if (typeof cur.message === "string") casti.push(cur.message);
    cur = cur.cause as { message?: string; cause?: unknown } | undefined;
  }
  return casti.join(" | ");
}
