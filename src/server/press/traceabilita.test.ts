// Traceability report pre odberateľa (F3): DL → príkazy/výkony → dávky →
// labák (verdikt + merania voči snapshot limitom) → šarže surovín s dodávateľom.
// Fixtures bežia plným tokom služieb (príjem → navážka → labák → výkon → DL),
// takže queries sa testujú nad dátami, aké vyrába produkčný kód.
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedFaktura, seedZaklad, type TestDb } from "@/test/pglite";
import {
  odovzdajNaLabak,
  vydajNavazkuDavky,
} from "@/server/batches/service";
import { stornoVydaja } from "@/server/inventory/corrections";
import { pociatocnyStav, prijemZoFaktury } from "@/server/inventory/receipts";
import { vynesVerdikt, zapisMerania } from "@/server/lab/service";
import {
  seedLisovnaZaklad,
  type LisovnaZaklad,
  type Zaklad,
} from "./fixtures";
import { zalozPrikaz } from "./orders";
import { stornoVykon, zapisVykon } from "./runs";
import { stornoDodaciList, vytvorDodaciList } from "./shipments";
import { traceabilitaDodacieho } from "./queries";

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;

beforeEach(async () => {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
});

/** Šarža materiálu z príjemky viazanej na faktúru (dodávateľ zo seedZaklad). */
async function pripravLotZFaktury(opts: { lotCode?: string } = {}) {
  const { faktura, polozka } = await seedFaktura(db, z);
  return prijemZoFaktury(db, {
    userId: z.adminId,
    invoiceId: faktura.id,
    receiptNumber: "P-2026-0001",
    receivedAt: "2026-07-10",
    polozky: [
      {
        materialId: z.material.id,
        invoiceItemId: polozka.id,
        supplierLotCode: opts.lotCode ?? "LOT-A1",
        qty: "500.000",
        unitPrice: "45.3500",
      },
    ],
  });
}

/** Rozpracovaná dávka na recepte ZMES-A (priamy insert — vzor fixtures). */
async function zalozDavkuRozpracovanu(cislo: string) {
  const [davka] = await db
    .insert(schema.productionBatches)
    .values({
      batchNumber: cislo,
      recipeId: z.recept.id,
      productionDate: "2026-07-14",
      shift: "ranna",
      machineId: z.stroj.id,
      leadWorkerId: z.pracovnik.id,
      createdBy: z.adminId,
    })
    .returning();
  return davka;
}

/** Dávka so spotrebou zo skladu, prevedená labákom do stavu schválená. */
async function pripravDavkuSoSpotrebou(cislo: string, qtyKg = "50.000") {
  const davka = await zalozDavkuRozpracovanu(cislo);
  await vydajNavazkuDavky(db, {
    userId: z.adminId,
    batchId: davka.id,
    polozky: [{ materialId: z.material.id, qty: qtyKg }],
  });
  await schvalDavku(davka.id);
  return davka;
}

async function schvalDavku(batchId: string, hodnota = "60") {
  await odovzdajNaLabak(db, { userId: z.adminId, batchId, outputKg: "100.000" });
  const { test: meranie } = await zapisMerania(db, {
    userId: z.adminId,
    batchId,
    merania: [{ parameterId: lz.parametre["TVRDOST"].id, value: hodnota }],
  });
  await vynesVerdikt(db, {
    userId: z.adminId,
    labTestId: meranie.id,
    verdict: "schvalene",
  });
}

async function zapisVykonPre(
  workOrderId: string,
  batchId: string,
  opts: { runDate?: string; shift?: "ranna" | "poobedna" | "nocna"; pairs?: number } = {},
) {
  return zapisVykon(db, {
    userId: z.adminId,
    workOrderId,
    machineId: lz.lis.id,
    batchId,
    runDate: opts.runDate ?? "2026-07-15",
    shift: opts.shift ?? "ranna",
    cyclesCount: 50,
    pairsProduced: opts.pairs ?? 100,
    mixtureKg: "20.000",
    workerId: z.pracovnik.id,
  });
}

async function vytvorDL(polozky: { workOrderId: string; qtyPairs: number }[]) {
  return vytvorDodaciList(db, {
    userId: z.adminId,
    shipDate: "2026-07-16",
    customer: "LOWA",
    polozky,
  });
}

describe("traceabilitaDodacieho", () => {
  test("plný reťazec: výkony (stroj/dátum/zmena), dávky s verdiktom a meraniami, šarže s dodávateľom", async () => {
    await pripravLotZFaktury();
    const davka1 = await pripravDavkuSoSpotrebou("V-2026-0001");
    const davka2 = await pripravDavkuSoSpotrebou("V-2026-0002");
    const prikaz = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 500,
    });
    await zapisVykonPre(prikaz.id, davka1.id, { shift: "ranna", pairs: 120 });
    await zapisVykonPre(prikaz.id, davka2.id, {
      runDate: "2026-07-16",
      shift: "poobedna",
      pairs: 80,
    });
    const { shipment } = await vytvorDL([{ workOrderId: prikaz.id, qtyPairs: 150 }]);

    const report = await traceabilitaDodacieho(db, shipment.id);

    expect(report.dodaci.shipmentNumber).toMatch(/^DL-\d{4}-\d{4}$/);
    expect(report.dodaci.customer).toBe("LOWA");
    expect(report.dodaci.shipDate).toBe("2026-07-16");

    expect(report.polozky).toHaveLength(1);
    const polozka = report.polozky[0];
    expect(polozka.orderNumber).toBe(prikaz.orderNumber);
    expect(polozka.artikelCode).toBe("POD-100");
    expect(polozka.artikelName).toBe("Podošva Trek 100");
    expect(polozka.qtyPairs).toBe(150);
    expect(polozka.vykony).toEqual([
      {
        machineCode: "LIS1",
        machineName: "Lis 1",
        runDate: "2026-07-15",
        shift: "ranna",
        pairsProduced: 120,
        batchNumber: "V-2026-0001",
      },
      {
        machineCode: "LIS1",
        machineName: "Lis 1",
        runDate: "2026-07-16",
        shift: "poobedna",
        pairsProduced: 80,
        batchNumber: "V-2026-0002",
      },
    ]);

    expect(report.davky.map((d) => d.batchNumber)).toEqual([
      "V-2026-0001",
      "V-2026-0002",
    ]);
    for (const davka of report.davky) {
      expect(davka.mixtureCode).toBe("ZMES-A");
      expect(davka.mixtureName).toBe("Zmes A");
      expect(davka.productionDate).toBe("2026-07-14");

      expect(davka.verdikt).not.toBeNull();
      expect(davka.verdikt?.verdict).toBe("schvalene");
      expect(davka.verdikt?.verdictAt).toBeInstanceOf(Date);
      expect(davka.verdikt?.verdictByName).toBe("Test Admin");

      expect(davka.merania).toHaveLength(1);
      const meranie = davka.merania[0];
      expect(meranie.parameterCode).toBe("TVRDOST");
      expect(Number(meranie.value)).toBe(60);
      expect(Number(meranie.minLimit)).toBe(50);
      expect(Number(meranie.maxLimit)).toBe(70);
      expect(meranie.isWithinLimits).toBe(true);

      expect(davka.sarze).toEqual([
        {
          materialCode: "SADZE-N330",
          materialName: "Sadze N330",
          supplierLotCode: "LOT-A1",
          receiptNumber: "P-2026-0001",
          receivedAt: "2026-07-10",
          supplierName: "Test dodávateľ s.r.o.",
        },
      ]);
    }
  });

  test("dávka po zamietnutí a úprave: report ukáže len posledný verdikt a jeho merania", async () => {
    const davka = await zalozDavkuRozpracovanu("V-2026-0001");
    await odovzdajNaLabak(db, {
      userId: z.adminId,
      batchId: davka.id,
      outputKg: "100.000",
    });
    const { test: meranie1 } = await zapisMerania(db, {
      userId: z.adminId,
      batchId: davka.id,
      merania: [{ parameterId: lz.parametre["TVRDOST"].id, value: "80" }],
    });
    await vynesVerdikt(db, {
      userId: z.adminId,
      labTestId: meranie1.id,
      verdict: "zamietnute",
      instrukcia: "Domiešať zmäkčovadlo.",
    });
    // úprava dávky → nové odovzdanie a meranie v limite
    await schvalDavku(davka.id, "60");

    const prikaz = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 100,
    });
    await zapisVykonPre(prikaz.id, davka.id);
    const { shipment } = await vytvorDL([{ workOrderId: prikaz.id, qtyPairs: 50 }]);

    const report = await traceabilitaDodacieho(db, shipment.id);
    expect(report.davky).toHaveLength(1);
    const d = report.davky[0];
    expect(d.verdikt?.verdict).toBe("schvalene");
    expect(d.merania).toHaveLength(1);
    expect(Number(d.merania[0].value)).toBe(60);
  });

  test("šarža z príjemky počiatočného stavu má dodávateľa null", async () => {
    await pociatocnyStav(db, {
      userId: z.adminId,
      receiptNumber: "P-2026-0009",
      receivedAt: "2026-07-01",
      polozky: [
        {
          materialId: z.material.id,
          supplierLotCode: "STARY-LOT",
          qty: "100.000",
          unitPrice: "40.0000",
        },
      ],
    });
    const davka = await pripravDavkuSoSpotrebou("V-2026-0001");
    const prikaz = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 100,
    });
    await zapisVykonPre(prikaz.id, davka.id);
    const { shipment } = await vytvorDL([{ workOrderId: prikaz.id, qtyPairs: 50 }]);

    const report = await traceabilitaDodacieho(db, shipment.id);
    expect(report.davky[0].sarze).toEqual([
      {
        materialCode: "SADZE-N330",
        materialName: "Sadze N330",
        supplierLotCode: "STARY-LOT",
        receiptNumber: "P-2026-0009",
        receivedAt: "2026-07-01",
        supplierName: null,
      },
    ]);
  });

  test("tá istá dávka vo viacerých príkazoch je v davky práve raz", async () => {
    await pripravLotZFaktury();
    const davka = await pripravDavkuSoSpotrebou("V-2026-0001");
    const prikaz1 = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 100,
    });
    const prikaz2 = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 100,
    });
    await zapisVykonPre(prikaz1.id, davka.id);
    await zapisVykonPre(prikaz2.id, davka.id, { shift: "poobedna" });
    const { shipment } = await vytvorDL([
      { workOrderId: prikaz1.id, qtyPairs: 40 },
      { workOrderId: prikaz2.id, qtyPairs: 40 },
    ]);

    const report = await traceabilitaDodacieho(db, shipment.id);
    expect(report.polozky).toHaveLength(2);
    expect(report.davky).toHaveLength(1);
    expect(report.davky[0].batchNumber).toBe("V-2026-0001");
  });

  test("stornovaný výkon vypadne z výkonov aj z dávok", async () => {
    await pripravLotZFaktury();
    const davka1 = await pripravDavkuSoSpotrebou("V-2026-0001");
    const davka2 = await pripravDavkuSoSpotrebou("V-2026-0002");
    const prikaz = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 500,
    });
    await zapisVykonPre(prikaz.id, davka1.id);
    const vykon2 = await zapisVykonPre(prikaz.id, davka2.id, { shift: "poobedna" });
    const { shipment } = await vytvorDL([{ workOrderId: prikaz.id, qtyPairs: 50 }]);
    await stornoVykon(db, { userId: z.adminId, id: vykon2.run.id });

    const report = await traceabilitaDodacieho(db, shipment.id);
    expect(report.polozky[0].vykony).toHaveLength(1);
    expect(report.davky.map((d) => d.batchNumber)).toEqual(["V-2026-0001"]);
  });

  test("stornovaný výdaj navážky šaržu z reportu vyradí (čistá spotreba 0)", async () => {
    await pripravLotZFaktury();
    const davka = await zalozDavkuRozpracovanu("V-2026-0001");
    const { pohyby } = await vydajNavazkuDavky(db, {
      userId: z.adminId,
      batchId: davka.id,
      polozky: [{ materialId: z.material.id, qty: "50.000" }],
    });
    await stornoVydaja(db, { userId: z.adminId, moveId: pohyby[0].id });
    await schvalDavku(davka.id);
    const prikaz = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 100,
    });
    await zapisVykonPre(prikaz.id, davka.id);
    const { shipment } = await vytvorDL([{ workOrderId: prikaz.id, qtyPairs: 50 }]);

    const report = await traceabilitaDodacieho(db, shipment.id);
    expect(report.davky[0].sarze).toEqual([]);
  });

  test("neexistujúci dodací list vyhodí chybu", async () => {
    await expect(
      traceabilitaDodacieho(db, "00000000-0000-0000-0000-00000000dead"),
    ).rejects.toThrow("Dodací list neexistuje.");
  });

  test("stornovaný dodací list vyhodí chybu (soft delete)", async () => {
    await pripravLotZFaktury();
    const davka = await pripravDavkuSoSpotrebou("V-2026-0001");
    const prikaz = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 100,
    });
    await zapisVykonPre(prikaz.id, davka.id);
    const { shipment } = await vytvorDL([{ workOrderId: prikaz.id, qtyPairs: 50 }]);
    await stornoDodaciList(db, { userId: z.adminId, id: shipment.id });

    await expect(traceabilitaDodacieho(db, shipment.id)).rejects.toThrow(
      "Dodací list neexistuje.",
    );
  });

  test("výkony reportu nemôžu klesnúť pod expedované množstvo (DB invariant §12)", async () => {
    await pripravLotZFaktury();
    const davka = await pripravDavkuSoSpotrebou("V-2026-0001");
    const prikaz = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 100,
    });
    const vykon = await zapisVykonPre(prikaz.id, davka.id);
    const { shipment } = await vytvorDL([{ workOrderId: prikaz.id, qtyPairs: 50 }]);

    // Storno jediného výkonu by znížilo vyrobené pod expedované — DB guard
    // to zamietne, takže „DL s prázdnymi výkonmi" legálne nevznikne.
    await expect(
      stornoVykon(db, { userId: z.adminId, id: vykon.run.id }),
    ).rejects.toSatisfy((e) =>
      plnaHlaska(e).includes("pod už expedované množstvo"),
    );

    const report = await traceabilitaDodacieho(db, shipment.id);
    expect(report.polozky[0].vykony).toHaveLength(1);
    expect(report.davky).toHaveLength(1);
  });

  test("report neobsahuje peniaze, faktúry, poznámku DL ani kg množstvá (externý dokument)", async () => {
    await pripravLotZFaktury();
    const davka = await pripravDavkuSoSpotrebou("V-2026-0001");
    const prikaz = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 100,
    });
    await zapisVykonPre(prikaz.id, davka.id);
    const { shipment } = await vytvorDL([{ workOrderId: prikaz.id, qtyPairs: 50 }]);

    const report = await traceabilitaDodacieho(db, shipment.id);
    const kluce = new Set<string>();
    zbierajKluce(report, kluce);
    // Zakázané kategórie externého dokumentu: peniaze, faktúry, interná
    // poznámka DL a množstvá surovín (kg/qty — povolené sú len páry).
    const zakazane = [...kluce].filter(
      (k) =>
        /price|cents|cena|eur|invoice|faktur|note/i.test(k) ||
        /kg/i.test(k) ||
        (/^qty/i.test(k) && k !== "qtyPairs"),
    );
    expect(zakazane).toEqual([]);
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

function zbierajKluce(hodnota: unknown, kluce: Set<string>) {
  if (Array.isArray(hodnota)) {
    for (const v of hodnota) zbierajKluce(v, kluce);
    return;
  }
  if (hodnota && typeof hodnota === "object" && !(hodnota instanceof Date)) {
    for (const [k, v] of Object.entries(hodnota)) {
      kluce.add(k);
      zbierajKluce(v, kluce);
    }
  }
}
