// Mesačná uzávierka (M7) — TDD PRED implementáciou. Očakávané centy a sadzby
// sú ručne prepočítané zo scenára v calc/fixtures.ts (D2 kľúče, D4 60/40):
//   valcovňa: pool 30 000+12 000+60 000 = 102 000 c / 160 kg = 637,5 c/kg
//   lisovňa:  pool 50 000+40 000 = 90 000 c / 200 cyklov = 450 c/cyklus
//   labák:    pool 840 c / priame náklady 7 429 c = 11,307040 %
//             (840/7429 = 0,1130703997…; 7429×11 307 039 = 83 999 992 731,
//              zvyšok 7 269/7 429 ≈ 0,98 → half up)
//   správa:   základ = zložky mesiaca, na ktoré sa % reálne aplikuje
//             (v_work_order_costs): zmes výkonov 60×68 501/100 +
//             40×41 768/60 = 41 100,6 + 27 845,333… = 68 945,933… c
//             + réžia lisovne 200×450 = 90 000 c + práca lisovne 2 700 c
//             = 161 645,933… → 161 646 c (raz zaokrúhlené);
//             pool 21 000 / 161 646 = 12,991351 %
//             (161646×12 991 351 = 2 099 999 923 746, zvyšok
//              76 254/161 646 ≈ 0,47 → dole)
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import {
  seedLisovnaZaklad,
  type LisovnaZaklad,
  type Zaklad,
} from "@/server/press/fixtures";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { otvorMesiac, uzavriMesiac, type UzavierkaSuhrn } from "./close";
import {
  pripravDavkuSNakladmi,
  seedKalkulacieZaklad,
  seedLisovnaJun,
  seedRezijnaFaktura,
  seedRezijneFakturyJun,
  seedVyrobaJun,
  type KalkZaklad,
  type VyrobaJun,
} from "./fixtures";
import { pociatocnyStav } from "@/server/inventory/receipts";

const DNES = "2026-07-16";

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;
let kz: KalkZaklad;

beforeEach(async () => {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
  kz = await seedKalkulacieZaklad(db, z);
});

/** Kompletný júnový scenár (faktúry + dávky + lisovňa). */
async function seedJun(): Promise<VyrobaJun> {
  await seedRezijneFakturyJun(db, z, lz, kz);
  const vyroba = await seedVyrobaJun(db, z, lz);
  await seedLisovnaJun(db, z, lz, kz, vyroba);
  return vyroba;
}

function uzavriJun(): Promise<UzavierkaSuhrn> {
  return uzavriMesiac(db, {
    period: "2026-06-01",
    userId: z.adminId,
    dnes: DNES,
  });
}

function riadok(suhrn: UzavierkaSuhrn, code: string) {
  const r = suhrn.riadky.find((r) => r.code === code);
  if (!r) throw new Error(`Chýba alokačný riadok strediska ${code}.`);
  return r;
}

describe("uzavriMesiac — pooly, základy a sadzby (D2 + D4)", () => {
  test("jún 2026 presne podľa ručného prepočtu; materiál a investícia nevstupujú", async () => {
    await seedJun();
    const suhrn = await uzavriJun();

    expect(suhrn.riadky).toHaveLength(4);
    expect(riadok(suhrn, "valcovna")).toMatchObject({
      poolCents: 102000,
      basis: "160.000",
      rate: "637.500000",
    });
    expect(riadok(suhrn, "lisovna")).toMatchObject({
      poolCents: 90000,
      basis: "200.000",
      rate: "450.000000",
    });
    expect(riadok(suhrn, "labak")).toMatchObject({
      poolCents: 840,
      basis: "7429.000",
      rate: "11.307040",
    });
    expect(riadok(suhrn, "sprava")).toMatchObject({
      poolCents: 21000,
      basis: "161646.000",
      rate: "12.991351",
    });

    // Perzistencia: živá uzávierka + 4 riadky archívu alokácií.
    const [close] = await db
      .select()
      .from(schema.periodCloses)
      .where(
        and(
          eq(schema.periodCloses.period, "2026-06-01"),
          isNull(schema.periodCloses.deletedAt),
        ),
      );
    expect(close).toBeDefined();
    const alokacie = await db
      .select()
      .from(schema.overheadAllocations)
      .where(eq(schema.overheadAllocations.periodCloseId, close.id));
    expect(alokacie).toHaveLength(4);
  });

  test("carry-forward správy: pool mesiaca bez lisovania sa alokuje v ďalšom mesiaci (review nález)", async () => {
    // Máj: réžie valcovne 10 000 c + správy 5 000 c, ŽIADNA výroba —
    // základ správy je 0 (žiadne zložky, na ktoré sa % aplikuje), oba pooly
    // sa prenášajú. Jún: bežný scenár.
    await seedRezijnaFaktura(db, z, {
      cislo: "FA-REZIE-2026-05B",
      deliveryDate: "2026-05-12",
      polozky: [
        { category: "rezia", costCenterId: z.stredisko.id, totalNetCents: 10000 },
        { category: "rezia", costCenterId: kz.sprava.id, totalNetCents: 5000 },
      ],
    });
    const maj = await uzavriMesiac(db, {
      period: "2026-05-01",
      userId: z.adminId,
      dnes: DNES,
    });
    expect(riadok(maj, "sprava")).toMatchObject({
      poolCents: 5000,
      basis: "0.000",
      rate: "0.000000",
    });

    await seedJun();
    const jun = await uzavriJun();
    // Valcovňa: 102 000 + 10 000 = 112 000 / 160 kg = 700 c/kg presne.
    expect(riadok(jun, "valcovna")).toMatchObject({
      poolCents: 112000,
      basis: "160.000",
      rate: "700.000000",
    });
    // Plné náklady dávok s novou sadzbou: D1 = 4 268 + 70 000 + 483 =
    // 74 751; D2 = 3 161 + 42 000 + 357 = 45 518. Základ správy:
    // 60×74 751/100 + 40×45 518/60 + 200×450 + 2 700 =
    // 44 850,6 + 30 345,333… + 90 000 + 2 700 = 167 895,933… → 167 896 c.
    // Pool správy: 21 000 + prenos 5 000 = 26 000 → 26 000/167 896 =
    // 15,485777 % (zvyšok 152 704/167 896 ≈ 0,91 → hore).
    expect(riadok(jun, "sprava")).toMatchObject({
      poolCents: 26000,
      basis: "167896.000",
      rate: "15.485777",
    });
  });

  test("cost_corrections mesiaca vstupujú do poolu strediska", async () => {
    const vyroba = await seedJun();
    await db.insert(schema.costCorrections).values({
      lotId: vyroba.lot.id,
      costCenterId: z.stredisko.id,
      periodDate: "2026-06-01",
      amountCents: 233,
      createdBy: z.adminId,
    });

    const suhrn = await uzavriJun();
    // 102 000 + 233 = 102 233 c / 160 kg = 638,95625 c/kg (presne)
    expect(riadok(suhrn, "valcovna")).toMatchObject({
      poolCents: 102233,
      basis: "160.000",
      rate: "638.956250",
    });
  });
});

describe("uzavriMesiac — ochrany", () => {
  test("idempotencia: druhé uzavretie toho istého mesiaca padne", async () => {
    await seedJun();
    await uzavriJun();
    await expect(uzavriJun()).rejects.toThrow(/uzavretý/);
  });

  test("len celý minulý mesiac a len 1. deň mesiaca", async () => {
    await expect(
      uzavriMesiac(db, { period: "2026-07-01", userId: z.adminId, dnes: DNES }),
    ).rejects.toThrow(/neskončil/);
    await expect(
      uzavriMesiac(db, { period: "2026-08-01", userId: z.adminId, dnes: DNES }),
    ).rejects.toThrow(/neskončil/);
    await expect(
      uzavriMesiac(db, { period: "2026-06-15", userId: z.adminId, dnes: DNES }),
    ).rejects.toThrow(/1\. deň/);
  });

  test("chronológia: starší mesiac s dokladmi musí byť uzavretý prvý; carry-forward réžií bez základu", async () => {
    await seedJun();
    // Májová réžia valcovne bez májovej výroby.
    await seedRezijnaFaktura(db, z, {
      cislo: "FA-REZIE-2026-05",
      deliveryDate: "2026-05-10",
      polozky: [
        { category: "rezia", costCenterId: z.stredisko.id, totalNetCents: 5000 },
      ],
    });

    await expect(uzavriJun()).rejects.toThrow(/5\/2026/);

    // Máj: pool bez výroby → basis 0, sadzba 0, pool sa prenáša ďalej.
    const maj = await uzavriMesiac(db, {
      period: "2026-05-01",
      userId: z.adminId,
      dnes: DNES,
    });
    expect(riadok(maj, "valcovna")).toMatchObject({
      poolCents: 5000,
      basis: "0.000",
      rate: "0.000000",
    });

    // Jún: 102 000 + prenos 5 000 = 107 000 c / 160 kg = 668,75 c/kg.
    const jun = await uzavriJun();
    expect(riadok(jun, "valcovna")).toMatchObject({
      poolCents: 107000,
      basis: "160.000",
      rate: "668.750000",
    });
  });

  test("hranica uzávierok: mesiac starší než posledná uzávierka sa už uzavrieť nedá (review nález)", async () => {
    await seedJun();
    await uzavriJun();
    // Máj je pod hranicou (jún uzavretý) — dodatočná uzávierka medzery
    // by rozbila carry-forward reťaz.
    await expect(
      uzavriMesiac(db, { period: "2026-05-01", userId: z.adminId, dnes: DNES }),
    ).rejects.toThrow(/chronologicky|starší/);
  });

  test("rozpracovaná dávka mesiaca (bez output_kg) blokuje uzávierku", async () => {
    await seedJun();
    await db.insert(schema.productionBatches).values({
      batchNumber: "V-2026-0199",
      recipeId: z.recept.id,
      productionDate: "2026-06-28",
      shift: "ranna",
      machineId: z.stroj.id,
      leadWorkerId: z.pracovnik.id,
      createdBy: z.adminId,
    });

    await expect(uzavriJun()).rejects.toThrow(/V-2026-0199/);
  });
});

describe("otvorMesiac (reopen) a prázdne mesiace", () => {
  test("otvoriť možno len poslednú živú uzávierku; po reopene možno mesiac uzavrieť znova", async () => {
    await seedJun();
    await uzavriJun();
    // Júl bez dokladov → štyri nulové riadky (pool 0, basis 0, sadzba 0).
    const jul = await uzavriMesiac(db, {
      period: "2026-07-01",
      userId: z.adminId,
      dnes: "2026-08-02",
    });
    for (const code of ["valcovna", "lisovna", "labak", "sprava"]) {
      expect(riadok(jul, code)).toMatchObject({
        poolCents: 0,
        basis: "0.000",
        rate: "0.000000",
      });
    }

    await expect(
      otvorMesiac(db, { period: "2026-06-01", userId: z.adminId }),
    ).rejects.toThrow(/posledn/);

    await otvorMesiac(db, { period: "2026-07-01", userId: z.adminId });
    const zivyJul = await db
      .select()
      .from(schema.periodCloses)
      .where(
        and(
          eq(schema.periodCloses.period, "2026-07-01"),
          isNull(schema.periodCloses.deletedAt),
        ),
      );
    expect(zivyJul).toHaveLength(0);

    // Re-close: nová uzávierka, starý archív ostáva na zmazanej.
    await uzavriMesiac(db, {
      period: "2026-07-01",
      userId: z.adminId,
      dnes: "2026-08-02",
    });

    await expect(
      otvorMesiac(db, { period: "2026-04-01", userId: z.adminId }),
    ).rejects.toThrow(/neexistuje/);
  });

  test("carry-forward reťaz: pool mesiaca bez výroby sa alokuje v najbližšom mesiaci s výrobou", async () => {
    // August: réžia valcovne 5 000 c, žiadna výroba.
    await seedRezijnaFaktura(db, z, {
      cislo: "FA-REZIE-2026-08",
      deliveryDate: "2026-08-10",
      polozky: [
        { category: "rezia", costCenterId: z.stredisko.id, totalNetCents: 5000 },
      ],
    });
    // September: réžia 10 000 c + dávka s 10 kg.
    await seedRezijnaFaktura(db, z, {
      cislo: "FA-REZIE-2026-09",
      deliveryDate: "2026-09-10",
      polozky: [
        { category: "rezia", costCenterId: z.stredisko.id, totalNetCents: 10000 },
      ],
    });
    await pociatocnyStav(db, {
      userId: z.adminId,
      receiptNumber: "P-CALC-9",
      receivedAt: "2026-09-01",
      polozky: [
        { materialId: z.material.id, qty: "50.000", unitPrice: "45.3500" },
      ],
    });
    await pripravDavkuSNakladmi(db, z, lz, {
      cislo: "V-2026-0900",
      productionDate: "2026-09-05",
      vydajKg: "1.000",
      pracaHodiny: "1.00",
      pracaSadzbaCents: 100,
      outputKg: "10.000",
    });

    const august = await uzavriMesiac(db, {
      period: "2026-08-01",
      userId: z.adminId,
      dnes: "2026-10-02",
    });
    expect(riadok(august, "valcovna")).toMatchObject({
      poolCents: 5000,
      basis: "0.000",
      rate: "0.000000",
    });

    const september = await uzavriMesiac(db, {
      period: "2026-09-01",
      userId: z.adminId,
      dnes: "2026-10-02",
    });
    // 10 000 + prenos 5 000 = 15 000 c / 10 kg = 1 500 c/kg.
    expect(riadok(september, "valcovna")).toMatchObject({
      poolCents: 15000,
      basis: "10.000",
      rate: "1500.000000",
    });
  });
});
