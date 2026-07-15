import { beforeEach, describe, expect, test } from "vitest";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  pripravSchvalenuDavku,
  pripravSchvalenuDavkuNaRecept,
  seedLisovnaZaklad,
  seedZmesB,
  type LisovnaZaklad,
  type Zaklad,
} from "./fixtures";
import { zalozPrikaz } from "./orders";
import { stornoVykon, zapisVykon } from "./runs";
import { zapisOrez } from "./scrap";
import { vytvorDodaciList } from "./shipments";
import {
  detailDodacieho,
  detailPrikazu,
  dostupneDavkyPreArtikel,
  zoznamPrikazov,
} from "./queries";

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;

beforeEach(async () => {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
});

async function pripravPrikazSVyrobou() {
  const prikaz = await zalozPrikaz(db, {
    userId: z.adminId,
    soleModelId: lz.artikel.id,
    qtyPairsPlanned: 500,
  });
  const davka = await pripravSchvalenuDavku(db, z, lz, {
    outputKg: "100.000",
  });
  const vykon1 = await zapisVykon(db, {
    userId: z.adminId,
    workOrderId: prikaz.id,
    machineId: lz.lis.id,
    batchId: davka.id,
    runDate: "2026-07-15",
    shift: "ranna",
    cyclesCount: 100,
    pairsProduced: 200,
    mixtureKg: "50.000",
    workerId: z.pracovnik.id,
    nepodarky: [{ defectReasonId: lz.dovod.id, qtyPairs: 5 }],
  });
  const vykon2 = await zapisVykon(db, {
    userId: z.adminId,
    workOrderId: prikaz.id,
    machineId: lz.lis.id,
    batchId: davka.id,
    runDate: "2026-07-15",
    shift: "poobedna",
    cyclesCount: 40,
    pairsProduced: 80,
    mixtureKg: "20.000",
    workerId: z.pracovnik.id,
    nepodarky: [{ defectReasonId: lz.dovod.id, qtyPairs: 3 }],
  });
  await zapisOrez(db, {
    userId: z.adminId,
    workOrderId: prikaz.id,
    qtyKg: "4.500",
    recordDate: "2026-07-15",
  });
  return { prikaz, davka, vykon1, vykon2 };
}

describe("zoznamPrikazov", () => {
  test("agreguje vyrobené/nepodarky/orez/expedované a ignoruje stornované výkony", async () => {
    const { prikaz, vykon2 } = await pripravPrikazSVyrobou();
    await vytvorDodaciList(db, {
      userId: z.adminId,
      shipDate: "2026-07-16",
      customer: "LOWA",
      polozky: [{ workOrderId: prikaz.id, qtyPairs: 150 }],
    });
    // storno druhého výkonu (80 párov, 3 nepodarky, 40 cyklov)
    await stornoVykon(db, { userId: z.adminId, id: vykon2.run.id });

    const zoznam = await zoznamPrikazov(db);
    expect(zoznam).toHaveLength(1);
    const r = zoznam[0];
    expect(r.orderNumber).toBe(prikaz.orderNumber);
    expect(r.artikelCode).toBe("POD-100");
    expect(r.vyrobenePary).toBe(200);
    expect(r.nepodarkyPary).toBe(5);
    expect(r.cykly).toBe(100);
    expect(r.orezKg).toBe("4.500");
    expect(r.expedovanePary).toBe(150);
  });
});

describe("detailPrikazu", () => {
  test("vracia výkony s deťmi, orez a hotové na sklade", async () => {
    const { prikaz } = await pripravPrikazSVyrobou();
    await vytvorDodaciList(db, {
      userId: z.adminId,
      shipDate: "2026-07-16",
      customer: "LOWA",
      polozky: [{ workOrderId: prikaz.id, qtyPairs: 100 }],
    });

    const detail = await detailPrikazu(db, prikaz.id);
    expect(detail.prikaz.id).toBe(prikaz.id);
    expect(detail.artikel.code).toBe("POD-100");
    expect(detail.vykony).toHaveLength(2);
    expect(detail.vykony[0].nepodarky.length + detail.vykony[1].nepodarky.length).toBe(2);
    expect(detail.vykony[0].davkaCislo).toBeTruthy();
    expect(detail.orezy).toHaveLength(1);
    expect(detail.suhrn.vyrobenePary).toBe(280);
    expect(detail.suhrn.nepodarkyPary).toBe(8);
    expect(detail.suhrn.expedovanePary).toBe(100);
    expect(detail.suhrn.hotoveNaSklade).toBe(180);
    expect(detail.expedicie).toHaveLength(1);
    expect(detail.expedicie[0].qtyPairs).toBe(100);
  });
});

describe("dostupneDavkyPreArtikel", () => {
  test("ponúka len schválené dávky správnej zmesi so zostatkom kg", async () => {
    // schválená ZMES-A so zostatkom (spotrebujeme 50 zo 100)
    const prikaz = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 100,
    });
    const davkaA = await pripravSchvalenuDavku(db, z, lz, {
      cislo: "V-2026-0001",
      outputKg: "100.000",
    });
    await zapisVykon(db, {
      userId: z.adminId,
      workOrderId: prikaz.id,
      machineId: lz.lis.id,
      batchId: davkaA.id,
      runDate: "2026-07-15",
      shift: "ranna",
      cyclesCount: 10,
      pairsProduced: 20,
      mixtureKg: "50.000",
      workerId: z.pracovnik.id,
    });

    // plne vyčerpaná schválená dávka ZMES-A
    const davkaPlna = await pripravSchvalenuDavku(db, z, lz, {
      cislo: "V-2026-0002",
      outputKg: "30.000",
    });
    await zapisVykon(db, {
      userId: z.adminId,
      workOrderId: prikaz.id,
      machineId: lz.lis.id,
      batchId: davkaPlna.id,
      runDate: "2026-07-15",
      shift: "ranna",
      cyclesCount: 5,
      pairsProduced: 10,
      mixtureKg: "30.000",
      workerId: z.pracovnik.id,
    });

    const { receptB } = await seedZmesB(db, z, lz);
    // schválená dávka nesprávnej zmesi (ZMES-B)
    await pripravSchvalenuDavkuNaRecept(db, z, {
      receptId: receptB.id,
      parameterId: lz.parametre["TVRDOST"].id,
      cislo: "V-2026-0003",
    });

    const dostupne = await dostupneDavkyPreArtikel(db, lz.artikel.id);
    expect(dostupne).toHaveLength(1);
    expect(dostupne[0].batchNumber).toBe("V-2026-0001");
    expect(dostupne[0].zostatokKg).toBe("50.000");
  });
});

describe("detailDodacieho", () => {
  test("položky nesú príkaz, artikel aj použité dávky (traceabilita)", async () => {
    const { prikaz, davka } = await pripravPrikazSVyrobou();
    const { shipment } = await vytvorDodaciList(db, {
      userId: z.adminId,
      shipDate: "2026-07-16",
      customer: "LOWA",
      polozky: [{ workOrderId: prikaz.id, qtyPairs: 50 }],
    });

    const detail = await detailDodacieho(db, shipment.id);
    expect(detail.dodaci.shipmentNumber).toBe(shipment.shipmentNumber);
    expect(detail.polozky).toHaveLength(1);
    expect(detail.polozky[0].orderNumber).toBe(prikaz.orderNumber);
    expect(detail.polozky[0].artikelCode).toBe("POD-100");
    expect(detail.polozky[0].davky).toHaveLength(1);
    expect(detail.polozky[0].davky[0].batchNumber).toBe(davka.batchNumber);
    expect(detail.polozky[0].davky[0].batchId).toBe(davka.id);
  });
});
