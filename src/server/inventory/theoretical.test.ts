// Živá teoretická kalkulácia receptu (M3, rozhodnutie OQ2 = FIFO simulácia):
// simuluje čerpanie zostatkov vo FIFO poradí. Nedostatok sa oceňuje cenou
// najnovšieho lotu a označí maNedostatok (informatívna, nie blokujúca).
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { pociatocnyStav } from "./receipts";
import { teoretickaKalkulacia } from "./theoretical";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // recept: 50 kg SADZE-N330 na 100 kg dávku
});

/** 200 kg @ 40 c (starší) + 300 kg @ 45 c (novší). */
async function dvaLoty() {
  await pociatocnyStav(db, {
    userId: zaklad.adminId,
    receiptNumber: "P-001",
    receivedAt: "2026-07-01",
    polozky: [
      { materialId: zaklad.material.id, qty: "200.000", unitPrice: "40.0000" },
    ],
  });
  await pociatocnyStav(db, {
    userId: zaklad.adminId,
    receiptNumber: "P-002",
    receivedAt: "2026-07-05",
    polozky: [
      { materialId: zaklad.material.id, qty: "300.000", unitPrice: "45.0000" },
    ],
  });
}

describe("teoretickaKalkulacia", () => {
  test("FIFO cena zo starších lotov: 50 kg × 40,0000 c = 2000 c", async () => {
    await dvaLoty();

    const v = await teoretickaKalkulacia(db, { recipeId: zaklad.recept.id });

    expect(v.maNedostatok).toBe(false);
    expect(v.polozky).toHaveLength(1);
    expect(v.polozky[0].qtyKg).toBe("50.000");
    expect(v.polozky[0].materialCents).toBe(2_000n);
    expect(v.materialCentsSpolu).toBe(2_000n);
  });

  test("spill cez loty: scale 5 → 250 kg = 200×40 + 50×45 = 10250 c", async () => {
    await dvaLoty();

    const v = await teoretickaKalkulacia(db, {
      recipeId: zaklad.recept.id,
      scaleFactor: "5.000",
    });

    expect(v.polozky[0].qtyKg).toBe("250.000");
    expect(v.materialCentsSpolu).toBe(10_250n);
    expect(v.maNedostatok).toBe(false);
  });

  test("nedostatok: chýbajúce kg za cenu NAJNOVŠIEHO lotu + maNedostatok", async () => {
    await dvaLoty(); // dostupné 500 kg

    const v = await teoretickaKalkulacia(db, {
      recipeId: zaklad.recept.id,
      scaleFactor: "12.000", // potrebuje 600 kg
    });

    // 200×40 + 300×45 = 21500; chýba 100 × 45 (najnovší) = 4500 → 26000
    expect(v.maNedostatok).toBe(true);
    expect(v.polozky[0].maNedostatok).toBe(true);
    expect(v.polozky[0].chybaKg).toBe("100.000");
    expect(v.materialCentsSpolu).toBe(26_000n);
  });

  test("materiál bez lotov: cena neznáma → 0 c + maNedostatok", async () => {
    const v = await teoretickaKalkulacia(db, { recipeId: zaklad.recept.id });

    expect(v.maNedostatok).toBe(true);
    expect(v.polozky[0].chybaKg).toBe("50.000");
    expect(v.polozky[0].materialCents).toBe(0n);
    expect(v.materialCentsSpolu).toBe(0n);
  });

  test("viac položiek: spolu = Σ položiek; zmena ceny suroviny sa okamžite prejaví", async () => {
    await dvaLoty();

    // Druhý materiál + položka receptu (recept nemá dávky → je mutovateľný).
    const [olej] = await db
      .insert(schema.materials)
      .values({
        code: "OLEJ-P1",
        name: "Procesný olej P1",
        unit: "kg",
        category: "olej",
        createdBy: zaklad.adminId,
      })
      .returning();
    await db.insert(schema.recipeItems).values({
      recipeId: zaklad.recept.id,
      materialId: olej.id,
      qtyKg: "10.000",
      createdBy: zaklad.adminId,
    });
    await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-003",
      receivedAt: "2026-07-06",
      polozky: [{ materialId: olej.id, qty: "100.000", unitPrice: "120.5000" }],
    });

    const v = await teoretickaKalkulacia(db, { recipeId: zaklad.recept.id });

    // 50×40 = 2000; 10×120,5 = 1205 → spolu 3205.
    expect(v.polozky).toHaveLength(2);
    expect(v.materialCentsSpolu).toBe(3_205n);

    // „Živá" kalkulácia: nový (drahší) príjem oleja nemení FIFO cenu,
    // kým starší lot stačí — ale po jeho vyčerpaní by sa prejavil.
    await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-004",
      receivedAt: "2026-07-07",
      polozky: [{ materialId: olej.id, qty: "100.000", unitPrice: "150.0000" }],
    });
    const v2 = await teoretickaKalkulacia(db, { recipeId: zaklad.recept.id });
    expect(v2.materialCentsSpolu).toBe(3_205n); // starší lot stále pokrýva 10 kg
  });

  test("neexistujúci recept → chyba", async () => {
    await expect(
      teoretickaKalkulacia(db, {
        recipeId: "00000000-0000-0000-0000-00000000dead",
      }),
    ).rejects.toThrow();
  });
});
