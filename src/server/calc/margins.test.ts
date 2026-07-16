// Marže per artikel + teoretická vs skutočná kalkulácia (M7). TDD PRED
// implementáciou. Ručný prepočet (scenár jún, P1 dokončený; P1 spolu
// 182 646 c — viď costs.test):
//   Ø náklad/pár = 182 646 / 380 = 480,6473… → 480,65 c.
//   Marža = 900 − 480,65 = 419,35 c → 419,35/900 = 46,594…% → 46,59 %.
//   Teoretická zmes na pár (POD-CALC, norma 0,250 kg): recept 50 kg
//   à 45,35 c = 2 268 c na 100 kg dávku → 0,250 × 2 268/100 = 5,67 → 6 c.
//   Skutočná zmes na pár = 68 946/380 = 181,4368… → 181,44 c.
//   Skutočná spotreba = 100 kg/380 párov = 0,26315… → 0,263 kg/pár
//   (norma 0,250 — nadspotreba cez orez a nepodarky, D5).
import { beforeEach, describe, expect, test } from "vitest";
import { dokonciPrikaz } from "@/server/press/orders";
import {
  seedLisovnaZaklad,
  type LisovnaZaklad,
  type Zaklad,
} from "@/server/press/fixtures";
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
import { marzeArtiklov } from "./margins";

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
  await uzavriMesiac(db, {
    period: "2026-06-01",
    userId: z.adminId,
    dnes: DNES,
  });
});

describe("marzeArtiklov", () => {
  test("bez dokončeného príkazu je skutočný náklad neznámy, teoretická kalkulácia žije", async () => {
    const marze = await marzeArtiklov(db);
    const podCalc = marze.find((m) => m.code === "POD-CALC");
    expect(podCalc).toMatchObject({
      salePriceCents: 900,
      dobreParov: 0,
      costPerPairCents: null,
      marginCents: null,
      marginPct: null,
      teoretickaZmesCents: 6,
      normaKgNaPar: "0.250",
      skutocnaZmesCents: null,
      skutocnaKgNaPar: null,
    });
  });

  test("dokončený príkaz: Ø náklad/pár, marža, teoretická vs skutočná presne", async () => {
    await dokonciPrikaz(db, { userId: z.adminId, id: lisovna.prikaz.id });

    const marze = await marzeArtiklov(db);
    const podCalc = marze.find((m) => m.code === "POD-CALC");
    expect(podCalc).toMatchObject({
      salePriceCents: 900,
      dobreParov: 380,
      costPerPairCents: "480.65",
      marginCents: "419.35",
      marginPct: "46.59",
      teoretickaZmesCents: 6,
      skutocnaZmesCents: "181.44",
      normaKgNaPar: "0.250",
      skutocnaKgNaPar: "0.263",
    });

    // Artikel bez predajnej ceny a bez výroby: len teoretická kalkulácia
    // (POD-100, norma 0,850 kg → 0,850 × 2 268/100 = 19,278 → 19 c).
    const pod100 = marze.find((m) => m.code === "POD-100");
    expect(pod100).toMatchObject({
      salePriceCents: null,
      dobreParov: 0,
      costPerPairCents: null,
      marginCents: null,
      teoretickaZmesCents: 19,
    });
  });

  test("dokončený príkaz so 100 % nepodarkami zostáva v priemere — D5 strata nezmizne (review nález)", async () => {
    await dokonciPrikaz(db, { userId: z.adminId, id: lisovna.prikaz.id });

    // WO-B: júlový výkon z D1, 10 cyklov, 0 dobrých párov, 8 nepodarkov,
    // 2 kg zmesi → po uzávierke júla (nulové sadzby): zmes
    // round(2×68 501/100) = 1 370 c, ostatné 0 → spolu 1 370 c, 0 párov.
    const { zalozPrikaz } = await import("@/server/press/orders");
    const { zapisVykon } = await import("@/server/press/runs");
    const woB = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: kz.artikel.id,
      qtyPairsPlanned: 50,
    });
    await zapisVykon(db, {
      userId: z.adminId,
      workOrderId: woB.id,
      machineId: lz.lis.id,
      batchId: vyroba.d1.id,
      runDate: "2026-07-06",
      shift: "ranna",
      cyclesCount: 10,
      pairsProduced: 0,
      mixtureKg: "2.000",
      workerId: z.pracovnik.id,
      nepodarky: [{ defectReasonId: lz.dovod.id, qtyPairs: 8 }],
    });
    await uzavriMesiac(db, {
      period: "2026-07-01",
      userId: z.adminId,
      dnes: "2026-08-02",
    });
    await dokonciPrikaz(db, { userId: z.adminId, id: woB.id });

    const marze = await marzeArtiklov(db);
    const podCalc = marze.find((m) => m.code === "POD-CALC");
    // Σ = 182 646 + 1 370 = 184 016 c / 380 dobrých párov (WO-B pridal 0):
    // 484,25 c/pár; marža 900 − 484,25 = 415,75 → 46,19 %.
    // Zmes: (68 946 + 1 370)/380 = 185,04 c; kg: 102/380 = 0,268.
    expect(podCalc).toMatchObject({
      dobreParov: 380,
      costPerPairCents: "484.25",
      marginCents: "415.75",
      marginPct: "46.19",
      skutocnaZmesCents: "185.04",
      skutocnaKgNaPar: "0.268",
    });
  });
});
