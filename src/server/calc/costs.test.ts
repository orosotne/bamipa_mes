// Kalkulačné views (M7): v_batch_full_costs (plný náklad dávky) a
// v_work_order_costs (náklad príkazu a na pár, D5). TDD PRED implementáciou.
//
// Ručný prepočet nad scenárom jún (sadzby z close.test.ts):
//   D1: priamy 4 268; valcovňa round(100 × 637,5) = 63 750; labák
//       round(4 268 × 11,307040 %) = round(482,584…) = 483;
//       plný 68 501 → 685,01 c/kg.
//   D2: priamy 3 161; valcovňa round(60 × 637,5) = 38 250; labák
//       round(3 161 × 11,307040 %) = round(357,415…) = 357;
//       plný 41 768 → round(41 768/60) = 696,13 c/kg.
//   P1 zmes: 60 × 68 501/100 + 40 × 41 768/60 = 41 100,6 + 27 845,333…
//       = 68 945,933… → 68 946 (zaokrúhlené RAZ).
//   P1 réžia lisovne: (120 + 80) × 450 = 90 000. Práca: 2 700.
//   P1 správa: základ = zmes + réžia lisovne + práca = 161 645,933… →
//       sadzba 12,991351 % (viď close.test) aplikovaná per zložka:
//       2 424 689/15 × 12 991 351/10⁸ = 31 499 985 864 839/1,5e9 =
//       20 999,99057… → 21 000 (Σ správy mesiaca sadne presne na pool).
//   P1 spolu: 68 946 + 2 700 + 90 000 + 21 000 = 182 646;
//       380 dobrých párov → round(182 646/380) = 480,65 c/pár
//       (7 nepodarkov a 5 kg orezu rozpustené v dobrých pároch — D5).
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import {
  seedLisovnaZaklad,
  type LisovnaZaklad,
  type Zaklad,
} from "@/server/press/fixtures";
import { stornoVykon, zapisVykon } from "@/server/press/runs";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { uzavriMesiac } from "./close";
import {
  seedKalkulacieZaklad,
  seedLisovnaJun,
  seedRezijneFakturyJun,
  seedVyrobaJun,
  type KalkZaklad,
  type LisovnaJun,
  type VyrobaJun,
} from "./fixtures";

const DNES = "2026-07-16";

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;
let kz: KalkZaklad;
let vyroba: VyrobaJun;
let lisovna: LisovnaJun;

beforeEach(async () => {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
  kz = await seedKalkulacieZaklad(db, z);
  await seedRezijneFakturyJun(db, z, lz, kz);
  vyroba = await seedVyrobaJun(db, z, lz);
  lisovna = await seedLisovnaJun(db, z, lz, kz, vyroba);
});

function rows<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : (res as { rows: unknown }).rows) as T[];
}

async function fullCost(batchId: string) {
  const res = await db.execute(sql`
    SELECT valcovna_overhead_cents, labak_overhead_cents, full_total_cents,
           full_cost_per_kg_cents
      FROM v_batch_full_costs WHERE batch_id = ${batchId}
  `);
  return rows<{
    valcovna_overhead_cents: string | null;
    labak_overhead_cents: string | null;
    full_total_cents: string | null;
    full_cost_per_kg_cents: string | null;
  }>(res)[0];
}

async function orderCost(workOrderId: string) {
  const res = await db.execute(sql`
    SELECT * FROM v_work_order_costs WHERE work_order_id = ${workOrderId}
  `);
  return rows<{
    cycles_count: number;
    pairs_produced: number;
    defect_pairs: number;
    mixture_kg: string;
    scrap_kg: string;
    mixture_cents: string | null;
    labor_cents: string;
    press_overhead_cents: string | null;
    sprava_cents: string | null;
    total_cents: string | null;
    cost_per_pair_cents: string | null;
  }>(res)[0];
}

async function uzavriJun() {
  await uzavriMesiac(db, {
    period: "2026-06-01",
    userId: z.adminId,
    dnes: DNES,
  });
}

describe("v_batch_full_costs", () => {
  test("pred uzávierkou sú réžie a plný náklad NULL (predbežná kalkulácia)", async () => {
    const d1 = await fullCost(vyroba.d1.id);
    expect(d1.valcovna_overhead_cents).toBeNull();
    expect(d1.labak_overhead_cents).toBeNull();
    expect(d1.full_total_cents).toBeNull();
    expect(d1.full_cost_per_kg_cents).toBeNull();
  });

  test("po uzávierke: réžia valcovne, labák a plný náklad na kg presne", async () => {
    await uzavriJun();

    const d1 = await fullCost(vyroba.d1.id);
    expect(Number(d1.valcovna_overhead_cents)).toBe(63750);
    expect(Number(d1.labak_overhead_cents)).toBe(483);
    expect(Number(d1.full_total_cents)).toBe(68501);
    expect(d1.full_cost_per_kg_cents).toBe("685.01");

    const d2 = await fullCost(vyroba.d2.id);
    expect(Number(d2.valcovna_overhead_cents)).toBe(38250);
    expect(Number(d2.labak_overhead_cents)).toBe(357);
    expect(Number(d2.full_total_cents)).toBe(41768);
    expect(d2.full_cost_per_kg_cents).toBe("696.13");
  });
});

describe("v_work_order_costs", () => {
  test("náklad príkazu a na pár presne; nepodarky a orez rozpustené (D5)", async () => {
    await uzavriJun();

    const p1 = await orderCost(lisovna.prikaz.id);
    expect(p1.cycles_count).toBe(200);
    expect(p1.pairs_produced).toBe(380);
    expect(p1.defect_pairs).toBe(7);
    expect(p1.mixture_kg).toBe("100.000");
    expect(p1.scrap_kg).toBe("5.000");
    expect(Number(p1.mixture_cents)).toBe(68946);
    expect(Number(p1.labor_cents)).toBe(2700);
    expect(Number(p1.press_overhead_cents)).toBe(90000);
    expect(Number(p1.sprava_cents)).toBe(21000);
    expect(Number(p1.total_cents)).toBe(182646);
    expect(p1.cost_per_pair_cents).toBe("480.65");
  });

  test("výkon v neuzavretom mesiaci → réžie/správa/spolu NULL; po uzávierke sa dopočítajú", async () => {
    await uzavriJun();
    // Júlový výkon na júnovej (uzavretej) dávke — zmes známa, réžie júla nie.
    await zapisVykon(db, {
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

    const predbezne = await orderCost(lisovna.prikaz.id);
    expect(predbezne.pairs_produced).toBe(400);
    // zmes: 68 945,933… + 5 × 68 501/100 (= 3 425,05) = 72 370,983… → 72 371
    expect(Number(predbezne.mixture_cents)).toBe(72371);
    expect(predbezne.press_overhead_cents).toBeNull();
    expect(predbezne.sprava_cents).toBeNull();
    expect(predbezne.total_cents).toBeNull();
    expect(predbezne.cost_per_pair_cents).toBeNull();

    // Júl bez faktúr → nulové sadzby; kalkulácia sa uzavrie na 400 pároch.
    await uzavriMesiac(db, {
      period: "2026-07-01",
      userId: z.adminId,
      dnes: "2026-08-02",
    });
    const finalne = await orderCost(lisovna.prikaz.id);
    expect(Number(finalne.mixture_cents)).toBe(72371);
    expect(Number(finalne.labor_cents)).toBe(2700);
    expect(Number(finalne.press_overhead_cents)).toBe(90000); // + 10 × 0
    expect(Number(finalne.sprava_cents)).toBe(21000); // júlové zložky × 0 %
    expect(Number(finalne.total_cents)).toBe(186071);
    expect(finalne.cost_per_pair_cents).toBe("465.18"); // 186 071 / 400
  });

  test("stornovaný výkon vypadne z kalkulácie (živé riadky)", async () => {
    await uzavriJun();
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
    await stornoVykon(db, { userId: z.adminId, id: run.id });

    const p1 = await orderCost(lisovna.prikaz.id);
    expect(p1.pairs_produced).toBe(380);
    expect(Number(p1.mixture_cents)).toBe(68946);
    expect(Number(p1.total_cents)).toBe(182646);
  });

  test("views bežia so security_invoker (RLS podkladov sa neobchádza cez PostgREST — review nález)", async () => {
    const res = await db.execute(sql`
      SELECT relname, reloptions::text AS opts
        FROM pg_class
       WHERE relname IN ('v_batch_costs', 'v_batch_full_costs', 'v_work_order_costs')
       ORDER BY relname
    `);
    const views = rows<{ relname: string; opts: string | null }>(res);
    expect(views).toHaveLength(3);
    for (const v of views) {
      expect(v.opts ?? "").toContain("security_invoker=true");
    }
  });

  test("príkaz bez výkonov má nulové zložky a NULL cenu na pár", async () => {
    const { zalozPrikaz } = await import("@/server/press/orders");
    const prazdny = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: kz.artikel.id,
      qtyPairsPlanned: 100,
    });
    const p = await orderCost(prazdny.id);
    expect(p.pairs_produced).toBe(0);
    expect(Number(p.mixture_cents)).toBe(0);
    expect(Number(p.labor_cents)).toBe(0);
    expect(Number(p.press_overhead_cents)).toBe(0);
    expect(Number(p.sprava_cents)).toBe(0);
    expect(Number(p.total_cents)).toBe(0);
    expect(p.cost_per_pair_cents).toBeNull();
  });
});
