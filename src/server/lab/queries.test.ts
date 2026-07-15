// M5 Labák — čítacie queries (fronta, detail, trendy, aktívna úprava). TDD.
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { odovzdajNaLabak } from "@/server/batches/service";
import { vydajNavazky } from "@/server/inventory/issue";
import { pociatocnyStav } from "@/server/inventory/receipts";
import { createTestDb, seedDavka, seedZaklad, type TestDb } from "@/test/pglite";
import {
  type LabParametreMapa,
  pripravDavkuNaLabak,
  seedLaborant,
  seedLabParametre,
  seedLimity,
} from "./fixtures";
import { vynesVerdikt, zapisMerania } from "./service";
import {
  aktivnaUprava,
  detailPreLabak,
  frontaDavok,
  trendParametra,
} from "./queries";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;
let params: LabParametreMapa;
let laborantId: string;

const LIMITY = [
  { code: "ML", min: "5.000", max: "10.000" },
  { code: "MH", min: null, max: "60.000" },
  { code: "TS2", min: "1.000", max: null },
];

function merania(values: Record<string, string>) {
  return Object.entries(values).map(([code, value]) => ({
    parameterId: params[code].id,
    value,
  }));
}

const V_LIMITE = { ML: "7.000", MH: "50.000", TS2: "2.000" };
const MIMO = { ML: "3.000", MH: "50.000", TS2: "2.000" };

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db);
  params = await seedLabParametre(db, zaklad.adminId);
  laborantId = (await seedLaborant(db, zaklad.adminId)).id;
  await seedLimity(db, {
    adminId: zaklad.adminId,
    mixtureId: zaklad.zmes.id,
    parametre: params,
    limity: LIMITY,
  });
});

describe("frontaDavok", () => {
  test("len dávky caka_na_labak, najstaršie prvé, s počtom testov", async () => {
    await pripravDavkuNaLabak(db, zaklad, { cislo: "V-2026-0002" });
    await pripravDavkuNaLabak(db, zaklad, { cislo: "V-2026-0001" });
    // rozpracovaná dávka (nie vo fronte)
    await seedDavka(db, zaklad, "V-2026-0003");

    const fronta = await frontaDavok(db);
    expect(fronta.map((f) => f.batchNumber)).toEqual([
      "V-2026-0001",
      "V-2026-0002",
    ]);
    expect(fronta[0].mixtureCode).toBe("ZMES-A");
    expect(fronta[0].pocetTestov).toBe(0);
  });

  test("po zamietnutí + reworku má dávka pocetTestov=1 (opakovaný test)", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad, { cislo: "V-2026-0005" });
    const { test: t } = await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania(MIMO),
    });
    await vynesVerdikt(db, {
      userId: laborantId,
      labTestId: t.id,
      verdict: "zamietnute",
      instrukcia: "Doplniť urýchľovač.",
    });
    await odovzdajNaLabak(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      outputKg: "101.000",
    });

    const fronta = await frontaDavok(db);
    expect(fronta).toHaveLength(1);
    expect(fronta[0].pocetTestov).toBe(1);
  });
});

describe("detailPreLabak", () => {
  test("dávka + definície + história testov (seq ASC) + posledná úprava", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad, { cislo: "V-2026-0007" });
    const { test: t1 } = await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania(MIMO),
    });
    await vynesVerdikt(db, {
      userId: laborantId,
      labTestId: t1.id,
      verdict: "zamietnute",
      instrukcia: "Pridať síru.",
    });
    await odovzdajNaLabak(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      outputKg: "101.000",
    });
    await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania(V_LIMITE),
    });

    const detail = await detailPreLabak(db, davka.id);
    expect(detail.mixtureCode).toBe("ZMES-A");
    expect(detail.definicie).toHaveLength(3);
    expect(detail.definicie.map((d) => d.code)).toEqual(["ML", "MH", "TS2"]);

    expect(detail.testy).toHaveLength(2);
    expect(detail.testy.map((t) => t.sequenceNo)).toEqual([1, 2]);
    const prvy = detail.testy[0];
    expect(prvy.verdict).toBe("zamietnute");
    expect(prvy.verdictByName).toBe("Laborantka Eva");
    expect(prvy.laborantName).toBe("Laborantka Eva");
    expect(prvy.vysledky).toHaveLength(3);
    const ml = prvy.vysledky.find((v) => v.parameterCode === "ML")!;
    expect(ml.isWithinLimits).toBe(false);

    expect(detail.poslednaUprava).not.toBeNull();
    expect(detail.poslednaUprava!.description).toMatch(/síru/);
    expect(detail.poslednaUprava!.triggeredBySequenceNo).toBe(1);
  });

  test("neexistujúca dávka → chyba", async () => {
    await expect(
      detailPreLabak(db, "00000000-0000-0000-0000-00000000dead"),
    ).rejects.toThrow(/neexistuje/i);
  });
});

describe("trendParametra", () => {
  test("časový rad hodnôt parametra pre zmes + aktuálne limity", async () => {
    const d1 = await pripravDavkuNaLabak(db, zaklad, { cislo: "V-2026-0011" });
    await zapisMerania(db, {
      userId: laborantId,
      batchId: d1.id,
      merania: merania({ ML: "7.000", MH: "50.000", TS2: "2.000" }),
    });
    const d2 = await pripravDavkuNaLabak(db, zaklad, { cislo: "V-2026-0012" });
    await zapisMerania(db, {
      userId: laborantId,
      batchId: d2.id,
      merania: merania({ ML: "3.000", MH: "50.000", TS2: "2.000" }),
    });

    const trend = await trendParametra(db, {
      mixtureId: zaklad.zmes.id,
      parameterId: params.ML.id,
    });
    expect(trend.body).toHaveLength(2);
    expect(trend.body.map((b) => b.value)).toEqual(["7.000", "3.000"]);
    expect(trend.body[1].isWithinLimits).toBe(false);
    expect(trend.limity).toEqual({ minValue: "5.000", maxValue: "10.000" });
  });

  test("bez meraní → prázdny rad", async () => {
    const trend = await trendParametra(db, {
      mixtureId: zaklad.zmes.id,
      parameterId: params.T90.id,
    });
    expect(trend.body).toHaveLength(0);
  });
});

describe("aktivnaUprava", () => {
  test("posledný adjustment + rework výdaje a práca", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad, { cislo: "V-2026-0021" });
    const { test: t } = await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania(MIMO),
    });
    const { adjustmentId } = await vynesVerdikt(db, {
      userId: laborantId,
      labTestId: t.id,
      verdict: "zamietnute",
      instrukcia: "Pridať 2 kg sadzí.",
    });

    // rework výdaj (potrebuje šaržu na sklade)
    await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-2026-0001",
      receivedAt: "2026-07-10",
      polozky: [
        { materialId: zaklad.material.id, qty: "100.000", unitPrice: "0.5000" },
      ],
    });
    await vydajNavazky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      materialId: zaklad.material.id,
      qty: "2.000",
      adjustmentId: adjustmentId!,
    });
    // rework práca (priamy insert — služba to povolí v Task 4)
    await db.insert(schema.batchLabor).values({
      batchId: davka.id,
      workerId: zaklad.pracovnik.id,
      workDate: "2026-07-12",
      hours: "1.50",
      hourlyRateCents: 1200,
      adjustmentId: adjustmentId!,
      createdBy: zaklad.adminId,
    });

    const uprava = await aktivnaUprava(db, davka.id);
    expect(uprava).not.toBeNull();
    expect(uprava!.adjustment.id).toBe(adjustmentId);
    expect(uprava!.triggeredBySequenceNo).toBe(1);
    expect(uprava!.vydaje).toHaveLength(1);
    expect(uprava!.vydaje[0].materialCode).toBe("SADZE-N330");
    expect(uprava!.praca).toHaveLength(1);
    expect(uprava!.praca[0].workerName).toBe("Ján Testovací");
  });

  test("dávka bez úpravy → null", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad, { cislo: "V-2026-0022" });
    expect(await aktivnaUprava(db, davka.id)).toBeNull();
  });
});
