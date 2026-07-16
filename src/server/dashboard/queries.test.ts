// Dashboard queries (M8): výrobné KPI, prestoje, cash-flow buckety, náklady
// v čase a top materiály. TDD PRED implementáciou — očakávania sú ručne
// prepočítané nad scenárom „jún 2026" z calc/fixtures (viď hlavička tam).
//
// Ručný prepočet KPI (jún, s dávkou V-0103 navyše len v KPI describe):
//   kg zmesí = 100 (D1) + 60 (D2) + 40 (V-0103) = 200,000.
//   dobré páry = 230 + 150 = 380; nepodarky = 7;
//   nepodarkovosť = 7/(380+7) = 1,808785… % → 1,81.
//   odpad = 5,000 kg; prestoje = 30 + 15 (valcovňa) + 45 (lisovňa) = 90 min.
//   FPY: prvé verdikty D1/D2 schválené, V-0103 zamietnutý → 2/3 = 66,67 %.
// Náklady (bez V-0103 — sadzby ako v costs.test.ts):
//   jún ZMES-A: priamy Σ 7 429 c / 160 kg = 46,43125 → 46,43 c/kg;
//   po uzávierke plný Σ 68 501 + 41 768 = 110 269 c / 160 kg = 689,18125
//   → 689,18 c/kg. P1: 182 646 c / 380 párov → 480,65 c/pár.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as s from "@/db/schema";
import { uzavriMesiac } from "@/server/calc/close";
import {
  pripravDavkuSNakladmi,
  seedKalkulacieZaklad,
  seedLisovnaJun,
  seedRezijneFakturyJun,
  seedVyrobaJun,
  type KalkZaklad,
  type LisovnaJun,
  type VyrobaJun,
} from "@/server/calc/fixtures";
import { pociatocnyStav } from "@/server/inventory/receipts";
import { vynesVerdikt, zapisMerania } from "@/server/lab/service";
import {
  seedLisovnaZaklad,
  type LisovnaZaklad,
  type Zaklad,
} from "@/server/press/fixtures";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  bucketujCashflow,
  kumulativneSplatne,
  nakladNaKgMesacne,
  nakladNaParMesacne,
  nepodarky,
  prestoje,
  topMaterialy,
  vyrobneKpi,
} from "./queries";

const DNES = "2026-07-16";
const JUN = { od: "2026-06-01", do: "2026-06-30" };
const JUL = { od: "2026-07-01", do: "2026-07-31" };

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;
let kz: KalkZaklad;
let vyroba: VyrobaJun;
let lisovna: LisovnaJun;

async function seedJun() {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
  kz = await seedKalkulacieZaklad(db, z);
  await seedRezijneFakturyJun(db, z, lz, kz);
  vyroba = await seedVyrobaJun(db, z, lz);
  lisovna = await seedLisovnaJun(db, z, lz, kz, vyroba);
}

/** Dávka s PRVÝM verdiktom ZAMIETNUTÉ (meranie mimo limitu TVRDOST 50–70). */
async function pridajZamietnutuDavku(vstup: {
  cislo: string;
  productionDate: string;
  vydajKg: string;
  outputKg: string;
}) {
  const davka = await pripravDavkuSNakladmi(db, z, lz, {
    ...vstup,
    pracaHodiny: "1.00",
    pracaSadzbaCents: 1000,
    schvalit: false,
  });
  const { test: meranie } = await zapisMerania(db, {
    userId: z.adminId,
    batchId: davka.id,
    merania: [{ parameterId: lz.parametre["TVRDOST"].id, value: "80" }],
  });
  await vynesVerdikt(db, {
    userId: z.adminId,
    labTestId: meranie.id,
    verdict: "zamietnute",
    instrukcia: "Tvrdosť mimo limitu — domiešať zmäkčovadlo.",
  });
  return davka;
}

describe("vyrobneKpi + prestoje", () => {
  beforeEach(async () => {
    await seedJun();
    // Tretia júnová dávka so zamietnutým prvým verdiktom (FPY 2/3).
    await pridajZamietnutuDavku({
      cislo: "V-2026-0103",
      productionDate: "2026-06-28",
      vydajKg: "20.000",
      outputKg: "40.000",
    });
    // Prestoje: valcovňa 30 min (porucha, D1) + 15 min (prestavba, D2),
    // lisovňa 45 min (porucha, výkon R1 z 12. 6.).
    const [prestavba] = await db
      .insert(s.downtimeReasons)
      .values({ code: "prestavba", name: "Prestavba", createdBy: z.adminId })
      .returning();
    await db.insert(s.batchDowntimes).values([
      {
        batchId: vyroba.d1.id,
        reasonId: lz.prestojDovod.id,
        minutes: 30,
        createdBy: z.adminId,
      },
      {
        batchId: vyroba.d2.id,
        reasonId: prestavba.id,
        minutes: 15,
        createdBy: z.adminId,
      },
    ]);
    const [r1] = await db
      .select()
      .from(s.pressRuns)
      .where(
        and(
          eq(s.pressRuns.workOrderId, lisovna.prikaz.id),
          eq(s.pressRuns.runDate, "2026-06-12"),
        ),
      );
    await db.insert(s.pressRunDowntimes).values({
      pressRunId: r1.id,
      reasonId: lz.prestojDovod.id,
      minutes: 45,
      createdBy: z.adminId,
    });
  });

  test("júnové KPI presne podľa ručného prepočtu", async () => {
    const kpi = await vyrobneKpi(db, JUN);
    expect(kpi.kgZmesi).toBe("200.000");
    expect(kpi.dobreParov).toBe(380);
    expect(kpi.nepodarkyParov).toBe(7);
    expect(kpi.nepodarkovostPct).toBe("1.81");
    expect(kpi.odpadKg).toBe("5.000");
    expect(kpi.prestojeMinuty).toBe(90);
    expect(kpi.fpyPct).toBe("66.67");
  });

  test("okno filtruje: júl bez výroby lisovne má prázdne KPI", async () => {
    // Júlová dávka mimo júnového okna (čaká na labák — bez verdiktu).
    await pripravDavkuSNakladmi(db, z, lz, {
      cislo: "V-2026-0201",
      productionDate: "2026-07-05",
      vydajKg: "10.000",
      pracaHodiny: "1.00",
      pracaSadzbaCents: 1000,
      outputKg: "50.000",
      schvalit: false,
    });

    const jun = await vyrobneKpi(db, JUN);
    expect(jun.kgZmesi).toBe("200.000"); // júlová dávka nevstupuje

    const jul = await vyrobneKpi(db, JUL);
    expect(jul.kgZmesi).toBe("50.000");
    expect(jul.dobreParov).toBe(0);
    expect(jul.nepodarkyParov).toBe(0);
    expect(jul.nepodarkovostPct).toBeNull(); // žiadne páry → bez percenta
    expect(jul.odpadKg).toBe("0.000");
    expect(jul.prestojeMinuty).toBe(0);
    expect(jul.fpyPct).toBeNull(); // dávka bez verdiktu nevstupuje do FPY
  });

  test("nepodarky per dôvod a stroj (Q5: kde vznikajú nepodarky)", async () => {
    const riadky = await nepodarky(db, JUN);
    expect(riadky).toEqual([
      {
        reasonCode: "bublina",
        reasonName: "Bublina",
        machineCode: "LIS1",
        machineName: "Lis 1",
        qtyPairs: 7,
      },
    ]);
    expect(await nepodarky(db, JUL)).toEqual([]);
  });

  test("prestoje per dôvod a stroj, prevádzka zo strediska stroja", async () => {
    const riadky = await prestoje(db, JUN);
    expect(riadky).toEqual([
      {
        reasonCode: "porucha",
        reasonName: "Porucha stroja",
        machineCode: "LIS1",
        machineName: "Lis 1",
        prevadzka: "lisovna",
        minutes: 45,
      },
      {
        reasonCode: "porucha",
        reasonName: "Porucha stroja",
        machineCode: "VAL1",
        machineName: "Valcovací stroj 1",
        prevadzka: "valcovna",
        minutes: 30,
      },
      {
        reasonCode: "prestavba",
        reasonName: "Prestavba",
        machineCode: "VAL1",
        machineName: "Valcovací stroj 1",
        prevadzka: "valcovna",
        minutes: 15,
      },
    ]);
  });
});

describe("nakladNaKgMesacne", () => {
  beforeEach(seedJun);

  test("pred uzávierkou: priamy náklad/kg, plný NULL, mesiac otvorený", async () => {
    const riadky = await nakladNaKgMesacne(db);
    expect(riadky).toEqual([
      {
        mixtureCode: "ZMES-A",
        mixtureName: "Zmes A",
        period: "2026-06-01",
        kg: "160.000",
        directPerKg: "46.43",
        fullPerKg: null,
        uzavrety: false,
      },
    ]);
  });

  test("po uzávierke: vážený plný náklad/kg presne (689,18)", async () => {
    await uzavriMesiac(db, { period: "2026-06-01", userId: z.adminId, dnes: DNES });
    const riadky = await nakladNaKgMesacne(db);
    expect(riadky).toHaveLength(1);
    expect(riadky[0].fullPerKg).toBe("689.18");
    expect(riadky[0].uzavrety).toBe(true);
  });

  test("zamietnutá dávka vstupuje do nákladu/kg mesiaca (výrobná realita)", async () => {
    await uzavriMesiac(db, { period: "2026-06-01", userId: z.adminId, dnes: DNES });
    // Júlová zamietnutá: výdaj 10 kg × 45,35 = 453,5 → 454 c + práca 1 000 c
    // = 1 454 c / 30 kg = 48,4666… → 48,47 c/kg (priamy).
    await pridajZamietnutuDavku({
      cislo: "V-2026-0203",
      productionDate: "2026-07-08",
      vydajKg: "10.000",
      outputKg: "30.000",
    });
    const riadky = await nakladNaKgMesacne(db);
    expect(riadky).toHaveLength(2);
    expect(riadky[1]).toEqual({
      mixtureCode: "ZMES-A",
      mixtureName: "Zmes A",
      period: "2026-07-01",
      kg: "30.000",
      directPerKg: "48.47",
      fullPerKg: null,
      uzavrety: false,
    });
  });
});

describe("nakladNaParMesacne", () => {
  beforeEach(seedJun);

  test("pred uzávierkou: mesiac posledného výkonu, cena NULL (nekompletné)", async () => {
    const riadky = await nakladNaParMesacne(db);
    expect(riadky).toEqual([
      {
        soleModelCode: "POD-CALC",
        soleModelName: "Podošva Kalk",
        period: "2026-06-01",
        pary: 380,
        costPerPair: null,
        kompletne: false,
      },
    ]);
  });

  test("po uzávierke: 480,65 c/pár presne", async () => {
    await uzavriMesiac(db, { period: "2026-06-01", userId: z.adminId, dnes: DNES });
    const riadky = await nakladNaParMesacne(db);
    expect(riadky).toEqual([
      {
        soleModelCode: "POD-CALC",
        soleModelName: "Podošva Kalk",
        period: "2026-06-01",
        pary: 380,
        costPerPair: "480.65",
        kompletne: true,
      },
    ]);
  });
});

describe("bucketujCashflow (čistá funkcia)", () => {
  const f = (dueDate: string, zostatokCents: number) => ({
    id: dueDate + zostatokCents,
    invoiceNumber: "F",
    supplierName: "D",
    dueDate,
    totalGrossCents: zostatokCents,
    zostatokCents,
    status: "schvalena" as const,
  });

  test("po splatnosti + 4 týždne dopredu + neskôr, hranice vrátane", () => {
    const buckety = bucketujCashflow(
      [
        f("2026-07-10", 5000), // po splatnosti
        f("2026-07-16", 1000), // dnes → týždeň 0
        f("2026-07-22", 2000), // dnes+6 → týždeň 0 (posledný deň)
        f("2026-07-23", 3000), // dnes+7 → týždeň 1
        f("2026-08-12", 4000), // dnes+27 → týždeň 3 (posledný deň)
        f("2026-08-13", 7000), // dnes+28 → neskôr
      ],
      "2026-07-16",
    );
    expect(buckety.poSplatnosti).toMatchObject({ sumaCents: 5000, pocet: 1 });
    expect(buckety.tyzdne).toHaveLength(4);
    expect(buckety.tyzdne[0]).toMatchObject({
      od: "2026-07-16",
      do: "2026-07-22",
      sumaCents: 3000,
      pocet: 2,
    });
    expect(buckety.tyzdne[1]).toMatchObject({ sumaCents: 3000, pocet: 1 });
    expect(buckety.tyzdne[2]).toMatchObject({ sumaCents: 0, pocet: 0 });
    expect(buckety.tyzdne[3]).toMatchObject({
      od: "2026-08-06",
      do: "2026-08-12",
      sumaCents: 4000,
      pocet: 1,
    });
    expect(buckety.neskor).toMatchObject({ sumaCents: 7000, pocet: 1 });
  });

  test("zaplatené faktúry (zostatok 0) sa ignorujú", () => {
    const buckety = bucketujCashflow(
      [f("2026-07-20", 0), f("2026-07-10", 0)],
      "2026-07-16",
    );
    expect(buckety.poSplatnosti.pocet).toBe(0);
    expect(buckety.tyzdne[0].pocet).toBe(0);
  });

  // SPEC M8: „splatné faktúry 7/14/30 dní" — kumulatívne súčty zhodné s M1
  // filtrom splatne_do (dnes ≤ splatnosť ≤ dnes+N vrátane hraníc).
  test("kumulatívne súčty do 7/14/30 dní vrátane hraníc", () => {
    const kumulativne = kumulativneSplatne(
      [
        f("2026-07-10", 100), // po splatnosti → nikde
        f("2026-07-16", 1000), // dnes → 7, 14, 30
        f("2026-07-23", 2000), // dnes+7 (hranica) → 7, 14, 30
        f("2026-07-24", 4000), // dnes+8 → 14, 30
        f("2026-08-14", 8000), // dnes+29 → len 30 (nález review: padal do „Neskôr")
        f("2026-08-15", 16000), // dnes+30 (hranica) → len 30
        f("2026-08-16", 32000), // dnes+31 → nikde
        f("2026-07-20", 0), // zaplatená → nikde
      ],
      "2026-07-16",
    );
    expect(kumulativne).toEqual([
      { dni: 7, sumaCents: 3000, pocet: 2 },
      { dni: 14, sumaCents: 7000, pocet: 3 },
      { dni: 30, sumaCents: 31000, pocet: 5 },
    ]);
  });
});

describe("topMaterialy", () => {
  let kaucukId: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    z = await seedZaklad(db);
    const [kaucuk] = await db
      .insert(s.materials)
      .values({
        code: "KAUCUK-SBR",
        name: "Kaučuk SBR",
        unit: "kg",
        category: "kaucuk",
        createdBy: z.adminId,
      })
      .returning();
    kaucukId = kaucuk.id;
    // Sadze: 100 kg × 50 c + 200 kg × 60 c = 5 000 + 12 000 = 17 000 c.
    // Kaučuk: 10 kg × 100 c = 1 000 c. Starý príjem 2025 je mimo okna.
    await pociatocnyStav(db, {
      userId: z.adminId,
      receiptNumber: "P-OLD",
      receivedAt: "2025-01-01",
      polozky: [{ materialId: z.material.id, qty: "999.000", unitPrice: "99.0000" }],
    });
    await pociatocnyStav(db, {
      userId: z.adminId,
      receiptNumber: "P-1",
      receivedAt: "2026-01-10",
      polozky: [{ materialId: z.material.id, qty: "100.000", unitPrice: "50.0000" }],
    });
    await pociatocnyStav(db, {
      userId: z.adminId,
      receiptNumber: "P-2",
      receivedAt: "2026-02-01",
      polozky: [{ materialId: kaucuk.id, qty: "10.000", unitPrice: "100.0000" }],
    });
    await pociatocnyStav(db, {
      userId: z.adminId,
      receiptNumber: "P-3",
      receivedAt: "2026-03-05",
      polozky: [{ materialId: z.material.id, qty: "200.000", unitPrice: "60.0000" }],
    });
  });

  const OKNO = { od: "2026-01-01", do: "2026-12-31" };

  test("poradie podľa hodnoty príjmov, posledná/predošlá cena a zmena %", async () => {
    const top = await topMaterialy(db, OKNO);
    expect(top).toHaveLength(2);

    // Hodnota (ranking) je z OKNA; trend/predošlá cena siahajú aj pred okno.
    expect(top[0].code).toBe("SADZE-N330");
    expect(top[0].hodnotaCents).toBe(17000);
    expect(top[0].poslednaCena).toBe("60.0000");
    expect(top[0].poslednyDodavatel).toBeNull(); // počiatočný stav bez faktúry
    expect(top[0].predoslaCena).toBe("50.0000");
    expect(top[0].zmenaPct).toBe("20.00");
    expect(top[0].body.map((b) => b.unitPrice)).toEqual([
      "99.0000",
      "50.0000",
      "60.0000",
    ]);

    expect(top[1].code).toBe("KAUCUK-SBR");
    expect(top[1].hodnotaCents).toBe(1000);
    expect(top[1].poslednaCena).toBe("100.0000");
    expect(top[1].predoslaCena).toBeNull();
    expect(top[1].zmenaPct).toBeNull();
    expect(top[1].body).toHaveLength(1);
  });

  test("predošlá cena siaha aj cez hranicu okna (nález review)", async () => {
    // Kaučuk: príjem pred oknom 90 c → jediný v okne 100 c = zmena +11,11 %.
    await pociatocnyStav(db, {
      userId: z.adminId,
      receiptNumber: "P-PRE",
      receivedAt: "2025-12-15",
      polozky: [{ materialId: kaucukId, qty: "5.000", unitPrice: "90.0000" }],
    });
    const top = await topMaterialy(db, OKNO);
    const kaucuk = top.find((t) => t.code === "KAUCUK-SBR");
    expect(kaucuk?.hodnotaCents).toBe(1000); // ranking stále len z okna
    expect(kaucuk?.poslednaCena).toBe("100.0000");
    expect(kaucuk?.predoslaCena).toBe("90.0000");
    expect(kaucuk?.zmenaPct).toBe("11.11");
  });

  test("limit orezáva zoznam", async () => {
    const top = await topMaterialy(db, { ...OKNO, limit: 1 });
    expect(top).toHaveLength(1);
    expect(top[0].code).toBe("SADZE-N330");
  });

  test("pokles ceny dáva zápornú zmenu %", async () => {
    await pociatocnyStav(db, {
      userId: z.adminId,
      receiptNumber: "P-4",
      receivedAt: "2026-04-01",
      polozky: [{ materialId: z.material.id, qty: "10.000", unitPrice: "50.0000" }],
    });
    const top = await topMaterialy(db, OKNO);
    // 60 → 50: (50 − 60)/60 = −16,666… % → −16,67.
    expect(top[0].poslednaCena).toBe("50.0000");
    expect(top[0].zmenaPct).toBe("-16.67");
  });
});
