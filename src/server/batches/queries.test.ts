// Čítacie queries dávok (M4): zoznam + detail (plán vs. skutočnosť, v_batch_costs).
// Akceptačné kritérium SPEC §12: skutočný náklad dávky ručne prepočítateľný.
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { sumLineCostsCents } from "@/server/inventory/money";
import { pociatocnyStav } from "@/server/inventory/receipts";
import { pridajSadzbu } from "@/server/workers/service";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  aktualizujCasy,
  odovzdajNaLabak,
  pridajPracu,
  pridajPrestoj,
  vydajNavazkuDavky,
  zalozDavku,
} from "./service";
import { detailDavky, zoznamDavok } from "./queries";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db);
});

async function novaDavka(cislo = "V-2026-0001") {
  return zalozDavku(db, {
    userId: zaklad.adminId,
    batchNumber: cislo,
    mixtureId: zaklad.zmes.id,
    productionDate: "2026-07-12",
    shift: "ranna",
    machineId: zaklad.stroj.id,
    leadWorkerId: zaklad.pracovnik.id,
    scaleFactor: "2.000", // recept má 50 kg zaklad.material → plán 100 kg
  });
}

describe("zoznamDavok", () => {
  test("zoradené od najnovšej, s názvami zmesi/stroja/obsluhy", async () => {
    await novaDavka("V-2026-0001");
    await zalozDavku(db, {
      userId: zaklad.adminId,
      batchNumber: "V-2026-0002",
      mixtureId: zaklad.zmes.id,
      productionDate: "2026-07-13",
      shift: "poobedna",
      machineId: zaklad.stroj.id,
      leadWorkerId: zaklad.pracovnik.id,
    });

    const zoznam = await zoznamDavok(db);

    expect(zoznam.map((d) => d.batchNumber)).toEqual([
      "V-2026-0002",
      "V-2026-0001",
    ]);
    expect(zoznam[0].mixtureCode).toBe("ZMES-A");
    expect(zoznam[0].machineCode).toBe("VAL1");
    expect(zoznam[0].leadWorkerName).toBe("Ján Testovací");
  });
});

describe("detailDavky", () => {
  test("dávka neexistuje → chyba", async () => {
    await expect(
      detailDavky(db, "00000000-0000-0000-0000-00000000dead"),
    ).rejects.toThrow();
  });

  test("plán = recipe_items × scale_factor, predvyplnený", async () => {
    const davka = await novaDavka();
    const detail = await detailDavky(db, davka.id);

    expect(detail.planKalkulacia.polozky).toHaveLength(1);
    expect(detail.planKalkulacia.polozky[0].materialId).toBe(zaklad.material.id);
    expect(detail.planKalkulacia.polozky[0].qtyKg).toBe("100.000"); // 50 × 2
  });

  test("AKCEPTAČNÉ KRITÉRIUM: naklady z v_batch_costs = ručný súčet výdajok × ceny + práca", async () => {
    await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-001",
      receivedAt: "2026-07-01",
      polozky: [
        { materialId: zaklad.material.id, qty: "200.000", unitPrice: "40.0000" },
        { materialId: zaklad.material.id, qty: "300.000", unitPrice: "45.0000" },
      ],
    });
    await pridajSadzbu(db, {
      userId: zaklad.adminId,
      workerId: zaklad.pracovnik.id,
      hourlyRateCents: 850,
      validFrom: "2026-01-01",
    });

    const davka = await novaDavka();

    const vysledokVydaja = await vydajNavazkuDavky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      polozky: [{ materialId: zaklad.material.id, qty: "100.000" }],
    });
    await pridajPracu(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      workerId: zaklad.pracovnik.id,
      workDate: "2026-07-12",
      hours: "8.00",
    });
    await odovzdajNaLabak(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      outputKg: "98.000",
    });

    const detail = await detailDavky(db, davka.id);

    const rucneMaterial = sumLineCostsCents(
      vysledokVydaja.pohyby.map((p) => ({
        qty: p.qtyDelta.replace("-", ""),
        price: p.unitPrice,
      })),
    );
    // 8,00 h × 850 c/h = 6800,00 → centy: 8 × 850 = 6800
    expect(detail.naklady?.materialCents).toBe(Number(rucneMaterial));
    expect(detail.naklady?.laborCents).toBe(6800);
    expect(detail.naklady?.totalCents).toBe(Number(rucneMaterial) + 6800);
    expect(detail.naklady?.costPerKgCents).toBe(
      Math.round(((Number(rucneMaterial) + 6800) / 98) * 100) / 100,
    );
  });

  test("skutočné pohyby + praca + prestoje sú v detaile", async () => {
    await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-001",
      receivedAt: "2026-07-01",
      polozky: [
        { materialId: zaklad.material.id, qty: "200.000", unitPrice: "40.0000" },
      ],
    });
    await pridajSadzbu(db, {
      userId: zaklad.adminId,
      workerId: zaklad.pracovnik.id,
      hourlyRateCents: 850,
      validFrom: "2026-01-01",
    });
    const [dovod] = await db
      .insert(schema.downtimeReasons)
      .values({ code: "porucha", name: "Porucha", createdBy: zaklad.adminId })
      .returning();

    const davka = await novaDavka();
    await vydajNavazkuDavky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      polozky: [{ materialId: zaklad.material.id, qty: "100.000" }],
    });
    await pridajPracu(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      workerId: zaklad.pracovnik.id,
      workDate: "2026-07-12",
      hours: "8.00",
    });
    await pridajPrestoj(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      reasonId: dovod.id,
      minutes: 15,
    });
    await aktualizujCasy(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      workMinutes: 240,
    });

    const detail = await detailDavky(db, davka.id);

    expect(detail.pohyby).toHaveLength(1);
    expect(detail.skutocnePolozky).toEqual([
      { materialId: zaklad.material.id, materialCode: "SADZE-N330", materialName: "Sadze N330", skutQtyKg: "100.000" },
    ]);
    expect(detail.praca).toHaveLength(1);
    expect(detail.praca[0].workerName).toBe("Ján Testovací");
    expect(detail.prestoje).toHaveLength(1);
    expect(detail.prestoje[0].reasonName).toBe("Porucha");
    expect(detail.davka.workMinutes).toBe(240);
    expect(detail.mixtureCode).toBe("ZMES-A");
    expect(detail.recipeVersion).toBe(1);
  });
});
