// Výdaj navážky (M4): FOR UPDATE FIFO protokol, multi-lot spill, rollback,
// rework (adjustment_id) a akceptačné kritérium „ručne prepočítateľné na dokladoch".
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import {
  createTestDb,
  seedDavka,
  seedZaklad,
  type TestDb,
} from "@/test/pglite";
import { NedostatokZasobyError } from "./fifo";
import { vydajNavazky } from "./issue";
import { sumLineCostsCents } from "./money";
import { pociatocnyStav } from "./receipts";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;
let davka: Awaited<ReturnType<typeof seedDavka>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db);
  davka = await seedDavka(db, zaklad);
});

/** Dva loty s rôznymi dňami príjmu a cenami (starší lacnejší). */
async function dvaLoty() {
  const p1 = await pociatocnyStav(db, {
    userId: zaklad.adminId,
    receiptNumber: "P-001",
    receivedAt: "2026-07-01",
    polozky: [
      { materialId: zaklad.material.id, qty: "200.000", unitPrice: "40.0000" },
    ],
  });
  const p2 = await pociatocnyStav(db, {
    userId: zaklad.adminId,
    receiptNumber: "P-002",
    receivedAt: "2026-07-05",
    polozky: [
      { materialId: zaklad.material.id, qty: "300.000", unitPrice: "45.0000" },
    ],
  });
  return { lotStarsi: p1.loty[0], lotNovsi: p2.loty[0] };
}

async function zostatok(lotId: string): Promise<string> {
  const [lot] = await db
    .select({ qty: schema.materialLots.qtyRemaining })
    .from(schema.materialLots)
    .where(eq(schema.materialLots.id, lotId));
  return lot.qty;
}

describe("vydajNavazky", () => {
  test("výdaj z jedného lotu: vydaj pohyb so snapshot cenou, zostatok znížený triggerom", async () => {
    const { lotStarsi } = await dvaLoty();

    const vysledok = await vydajNavazky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      materialId: zaklad.material.id,
      qty: "50.000",
    });

    expect(vysledok.pohyby).toHaveLength(1);
    expect(vysledok.pohyby[0].moveType).toBe("vydaj");
    expect(vysledok.pohyby[0].qtyDelta).toBe("-50.000");
    expect(vysledok.pohyby[0].batchId).toBe(davka.id);
    expect(vysledok.pohyby[0].unitPrice).toBe("40.0000");
    expect(vysledok.pohyby[0].lotId).toBe(lotStarsi.id);

    expect(await zostatok(lotStarsi.id)).toBe("150.000");
  });

  test("FIFO multi-lot spill: starší lot prvý, každý riadok s cenou SVOJHO lotu", async () => {
    const { lotStarsi, lotNovsi } = await dvaLoty();

    const vysledok = await vydajNavazky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      materialId: zaklad.material.id,
      qty: "350.000",
    });

    expect(vysledok.pohyby).toHaveLength(2);
    expect(vysledok.pohyby[0].lotId).toBe(lotStarsi.id);
    expect(vysledok.pohyby[0].qtyDelta).toBe("-200.000");
    expect(vysledok.pohyby[0].unitPrice).toBe("40.0000");
    expect(vysledok.pohyby[1].lotId).toBe(lotNovsi.id);
    expect(vysledok.pohyby[1].qtyDelta).toBe("-150.000");
    expect(vysledok.pohyby[1].unitPrice).toBe("45.0000");

    expect(await zostatok(lotStarsi.id)).toBe("0.000");
    expect(await zostatok(lotNovsi.id)).toBe("150.000");
  });

  test("nedostatok → NedostatokZasobyError a ŽIADEN pohyb nevznikne", async () => {
    await dvaLoty(); // spolu 500 kg

    await expect(
      vydajNavazky(db, {
        userId: zaklad.adminId,
        batchId: davka.id,
        materialId: zaklad.material.id,
        qty: "600.000",
      }),
    ).rejects.toThrow(NedostatokZasobyError);

    const vydaje = await db
      .select()
      .from(schema.stockMoves)
      .where(eq(schema.stockMoves.moveType, "vydaj"));
    expect(vydaje).toHaveLength(0);
  });

  test("rework výdaj nesie adjustment_id (vícenáklady úpravy)", async () => {
    await dvaLoty();

    // Rework slučka: dávka → čaká na labák → zamietnutá → adjustment.
    await vydajNavazky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      materialId: zaklad.material.id,
      qty: "100.000",
    });
    await db
      .update(schema.productionBatches)
      .set({ status: "caka_na_labak", outputKg: "98.000" })
      .where(eq(schema.productionBatches.id, davka.id));
    const [test1] = await db
      .insert(schema.labTests)
      .values({
        batchId: davka.id,
        sequenceNo: 1,
        verdict: "zamietnute",
        verdictBy: zaklad.adminId,
        verdictAt: new Date(),
        createdBy: zaklad.adminId,
      })
      .returning();
    await db
      .update(schema.productionBatches)
      .set({ status: "zamietnuta" })
      .where(eq(schema.productionBatches.id, davka.id));
    const [uprava] = await db
      .insert(schema.batchAdjustments)
      .values({
        batchId: davka.id,
        triggeredByLabTestId: test1.id,
        description: "Dodatočné prídavky sadzí",
        createdBy: zaklad.adminId,
      })
      .returning();

    const vysledok = await vydajNavazky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      materialId: zaklad.material.id,
      qty: "20.000",
      adjustmentId: uprava.id,
    });

    expect(vysledok.pohyby[0].adjustmentId).toBe(uprava.id);
  });

  test("AKCEPTAČNÉ KRITÉRIUM: náklad dávky z v_batch_costs = ručný súčet výdajok × ceny šarží", async () => {
    await dvaLoty();

    const vysledok = await vydajNavazky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      materialId: zaklad.material.id,
      qty: "273.456", // spill: 200 × 40,0000 + 73,456 × 45,0000
    });

    // Ručný prepočet na dokladoch (rovnaká politika: round raz na agregát).
    const rucne = sumLineCostsCents(
      vysledok.pohyby.map((p) => ({
        qty: p.qtyDelta.replace("-", ""),
        price: p.unitPrice,
      })),
    );
    // 200×40 = 8000,00 c; 73,456×45 = 3305,52 c; spolu 11305,52 → 11306
    expect(rucne).toBe(11_306n);

    const view = await db.execute(
      sql`SELECT material_cents FROM v_batch_costs WHERE batch_id = ${davka.id}`,
    );
    expect(Number(view.rows[0].material_cents)).toBe(Number(rucne));
  });
});
