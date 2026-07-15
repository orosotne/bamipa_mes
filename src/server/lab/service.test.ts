// M5 Labák — meranie a verdikt (QC brána). TDD nad PGlite (reálne triggre a CHECK-y).
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import {
  odovzdajNaLabak,
  pridajPracu,
  vydajNavazkuDavky,
} from "@/server/batches/service";
import { pociatocnyStav } from "@/server/inventory/receipts";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  type LabParametreMapa,
  pripravDavkuNaLabak,
  seedLaborant,
  seedLabParametre,
  seedLimity,
} from "./fixtures";
import { vynesVerdikt, zapisMerania } from "./service";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;
let params: LabParametreMapa;
let laborantId: string;

// Limity zmesi ZMES-A: ML má min+max, MH len-max, TS2 len-min.
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

// Plné meranie pokrývajúce práve definované parametre (ML, MH, TS2).
const V_LIMITE = { ML: "7.000", MH: "50.000", TS2: "2.000" };

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // ZMES-A + recept v1
  params = await seedLabParametre(db, zaklad.adminId);
  laborantId = (await seedLaborant(db, zaklad.adminId)).id;
  await seedLimity(db, {
    adminId: zaklad.adminId,
    mixtureId: zaklad.zmes.id,
    parametre: params,
    limity: LIMITY,
  });
});

describe("zapisMerania", () => {
  test("vytvorí test seq=1 + výsledky so snapshotmi limitov, created_by = laborant", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad);

    const { test: t, results } = await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania(V_LIMITE),
    });

    expect(t.sequenceNo).toBe(1);
    expect(t.verdict).toBeNull();
    expect(t.createdBy).toBe(laborantId);
    expect(results).toHaveLength(3);

    const ml = results.find((r) => r.parameterId === params.ML.id)!;
    expect(ml.minLimitSnapshot).toBe("5.000");
    expect(ml.maxLimitSnapshot).toBe("10.000");
    expect(ml.isWithinLimits).toBe(true);
    expect(ml.value).toBe("7.000");

    // audit_log zápis merania
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.tableName, "lab_tests"),
          eq(schema.auditLog.recordId, t.id),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  test("is_within_limits: v limite / pod min / nad max / len-max / len-min", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad);
    // ML=3 pod min; MH=70 nad max (len-max 60); TS2=0.5 pod min (len-min 1)
    const { results } = await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania({ ML: "3.000", MH: "70.000", TS2: "0.500" }),
    });
    const by = (code: string) =>
      results.find((r) => r.parameterId === params[code].id)!;
    expect(by("ML").isWithinLimits).toBe(false); // pod min
    expect(by("MH").isWithinLimits).toBe(false); // nad max
    expect(by("TS2").isWithinLimits).toBe(false); // pod min (len-min)

    const davka2 = await pripravDavkuNaLabak(db, zaklad, { cislo: "V-2026-0002" });
    const { results: r2 } = await zapisMerania(db, {
      userId: laborantId,
      batchId: davka2.id,
      merania: merania({ ML: "10.000", MH: "60.000", TS2: "1.000" }),
    });
    const by2 = (code: string) =>
      r2.find((r) => r.parameterId === params[code].id)!;
    // hranice inkluzívne
    expect(by2("ML").isWithinLimits).toBe(true);
    expect(by2("MH").isWithinLimits).toBe(true);
    expect(by2("TS2").isWithinLimits).toBe(true);
  });

  test("dávka mimo stavu caka_na_labak → chyba", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad);
    // schválime → stav schvalena
    const { test: t } = await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania(V_LIMITE),
    });
    await vynesVerdikt(db, {
      userId: laborantId,
      labTestId: t.id,
      verdict: "schvalene",
    });
    await expect(
      zapisMerania(db, {
        userId: laborantId,
        batchId: davka.id,
        merania: merania(V_LIMITE),
      }),
    ).rejects.toThrow(/labák|stav/i);
  });

  test("zmes bez definovaných limitov → chyba s návodom na Receptúry", async () => {
    // nová zmes bez definícií
    const [zmesB] = await db
      .insert(schema.mixtures)
      .values({ code: "ZMES-B", name: "Zmes B", createdBy: zaklad.adminId })
      .returning();
    const [receptB] = await db
      .insert(schema.recipes)
      .values({
        mixtureId: zmesB.id,
        version: 1,
        standardBatchKg: "100.000",
        createdBy: zaklad.adminId,
      })
      .returning();
    const [davkaB] = await db
      .insert(schema.productionBatches)
      .values({
        batchNumber: "V-2026-0009",
        recipeId: receptB.id,
        productionDate: "2026-07-12",
        shift: "ranna",
        machineId: zaklad.stroj.id,
        leadWorkerId: zaklad.pracovnik.id,
        createdBy: zaklad.adminId,
      })
      .returning();
    await odovzdajNaLabak(db, {
      userId: zaklad.adminId,
      batchId: davkaB.id,
      outputKg: "100.000",
    });

    await expect(
      zapisMerania(db, {
        userId: laborantId,
        batchId: davkaB.id,
        merania: merania({ ML: "7.000" }),
      }),
    ).rejects.toThrow(/limit|Receptúr/i);
  });

  test("neúplné meranie (chýba parameter) → chyba", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad);
    await expect(
      zapisMerania(db, {
        userId: laborantId,
        batchId: davka.id,
        merania: merania({ ML: "7.000", MH: "50.000" }), // chýba TS2
      }),
    ).rejects.toThrow(/parametre|parameter/i);
  });

  test("parameter navyše (nie v definíciách) → chyba", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad);
    await expect(
      zapisMerania(db, {
        userId: laborantId,
        batchId: davka.id,
        merania: merania({ ...V_LIMITE, T90: "3.000" }),
      }),
    ).rejects.toThrow(/parametre|parameter/i);
  });

  test("2. meranie kým 1. nemá verdikt → chyba", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad);
    await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania(V_LIMITE),
    });
    await expect(
      zapisMerania(db, {
        userId: laborantId,
        batchId: davka.id,
        merania: merania(V_LIMITE),
      }),
    ).rejects.toThrow(/verdik|meranie/i);
  });

  test("po zamietnutí + reworku → nové meranie seq=2", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad);
    const { test: t1 } = await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania({ ML: "3.000", MH: "50.000", TS2: "2.000" }),
    });
    await vynesVerdikt(db, {
      userId: laborantId,
      labTestId: t1.id,
      verdict: "zamietnute",
      instrukcia: "Pridať 2 kg urýchľovača.",
    });
    // rework: znovu odovzdať na labák
    await odovzdajNaLabak(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      outputKg: "101.000",
    });

    const { test: t2 } = await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania(V_LIMITE),
    });
    expect(t2.sequenceNo).toBe(2);
  });

  test("neplatná nameraná hodnota → chyba", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad);
    await expect(
      zapisMerania(db, {
        userId: laborantId,
        batchId: davka.id,
        merania: merania({ ML: "abc", MH: "50.000", TS2: "2.000" }),
      }),
    ).rejects.toThrow(/hodnot/i);
  });
});

describe("vynesVerdikt", () => {
  async function pripravSMeranim(cislo?: string, values = V_LIMITE) {
    const davka = await pripravDavkuNaLabak(db, zaklad, { cislo });
    const { test: t } = await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania(values),
    });
    return { davka, test: t };
  }

  test("schvalene → verdict+by+at naraz, dávka schvalena, audit", async () => {
    const { davka, test: t } = await pripravSMeranim();
    const { adjustmentId } = await vynesVerdikt(db, {
      userId: laborantId,
      labTestId: t.id,
      verdict: "schvalene",
    });
    expect(adjustmentId).toBeNull();

    const [ttest] = await db
      .select()
      .from(schema.labTests)
      .where(eq(schema.labTests.id, t.id));
    expect(ttest.verdict).toBe("schvalene");
    expect(ttest.verdictBy).toBe(laborantId);
    expect(ttest.verdictAt).not.toBeNull();

    const [b] = await db
      .select()
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.id, davka.id));
    expect(b.status).toBe("schvalena");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.tableName, "production_batches"),
          eq(schema.auditLog.action, "status_change"),
          eq(schema.auditLog.recordId, davka.id),
        ),
      );
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  test("zamietnute → dávka zamietnuta + batch_adjustments s inštrukciou", async () => {
    const { davka, test: t } = await pripravSMeranim(undefined, {
      ML: "3.000",
      MH: "50.000",
      TS2: "2.000",
    });
    const { adjustmentId } = await vynesVerdikt(db, {
      userId: laborantId,
      labTestId: t.id,
      verdict: "zamietnute",
      instrukcia: "Pridať 1,5 kg síry a znovu premiešať.",
    });
    expect(adjustmentId).not.toBeNull();

    const [b] = await db
      .select()
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.id, davka.id));
    expect(b.status).toBe("zamietnuta");

    const [adj] = await db
      .select()
      .from(schema.batchAdjustments)
      .where(eq(schema.batchAdjustments.id, adjustmentId!));
    expect(adj.batchId).toBe(davka.id);
    expect(adj.triggeredByLabTestId).toBe(t.id);
    expect(adj.description).toMatch(/síry/);
  });

  test("zamietnute bez inštrukcie → chyba", async () => {
    const { test: t } = await pripravSMeranim();
    await expect(
      vynesVerdikt(db, {
        userId: laborantId,
        labTestId: t.id,
        verdict: "zamietnute",
      }),
    ).rejects.toThrow(/inštrukci|úprav/i);
  });

  test("verdikt na už rozhodnutom teste → chyba", async () => {
    const { test: t } = await pripravSMeranim();
    await vynesVerdikt(db, {
      userId: laborantId,
      labTestId: t.id,
      verdict: "schvalene",
    });
    await expect(
      vynesVerdikt(db, {
        userId: laborantId,
        labTestId: t.id,
        verdict: "schvalene",
      }),
    ).rejects.toThrow(/verdik/i);
  });

  test("verdikt na staršom (nie poslednom) teste → chyba", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad);
    const { test: t1 } = await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania({ ML: "3.000", MH: "50.000", TS2: "2.000" }),
    });
    await vynesVerdikt(db, {
      userId: laborantId,
      labTestId: t1.id,
      verdict: "zamietnute",
      instrukcia: "Doplniť.",
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
    // pokus o verdikt na starom teste t1 (nie poslednom)
    await expect(
      vynesVerdikt(db, {
        userId: laborantId,
        labTestId: t1.id,
        verdict: "schvalene",
      }),
    ).rejects.toThrow(/posledn|verdik/i);
  });

  test("§12: priamy UPDATE dávky na schvalena bez verdiktu → DB trigger odmietne", async () => {
    const davka = await pripravDavkuNaLabak(db, zaklad);
    let chyba: unknown;
    try {
      await db
        .update(schema.productionBatches)
        .set({ status: "schvalena" })
        .where(eq(schema.productionBatches.id, davka.id));
    } catch (e) {
      chyba = e;
    }
    // Slovenská hláška triggera je v cause reťazci DrizzleQueryError.
    expect(plnaHlaska(chyba)).toMatch(/SCHVÁLENÉ|verdik/i);

    // Stav dávky ostal nezmenený — nedá sa použiť bez verdiktu.
    const [b] = await db
      .select()
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.id, davka.id));
    expect(b.status).toBe("caka_na_labak");
  });
});

// Rework beží cez M4 službu (majster valcovne dopĺňa dávku po zamietnutí).
// Task 4: overStavPreSpotrebu povolí výdaj/prácu v stave zamietnuta s adjustmentId.
describe("rework zámok (M4 služba, stav zamietnuta + adjustmentId)", () => {
  async function zamietnutaDavka(cislo?: string) {
    const davka = await pripravDavkuNaLabak(db, zaklad, { cislo });
    const { test: t } = await zapisMerania(db, {
      userId: laborantId,
      batchId: davka.id,
      merania: merania({ ML: "3.000", MH: "50.000", TS2: "2.000" }),
    });
    const { adjustmentId } = await vynesVerdikt(db, {
      userId: laborantId,
      labTestId: t.id,
      verdict: "zamietnute",
      instrukcia: "Doplniť sadze.",
    });
    return { davka, adjustmentId: adjustmentId! };
  }

  async function seedZasoba(qty = "100.000") {
    await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-2026-0001",
      receivedAt: "2026-07-10",
      polozky: [
        // unit_price je v centoch/kg (schéma stock_moves) → 50 c/kg.
        { materialId: zaklad.material.id, qty, unitPrice: "50.0000" },
      ],
    });
  }

  async function seedSadzba() {
    await db.insert(schema.laborRates).values({
      workerId: zaklad.pracovnik.id,
      hourlyRateCents: 1200,
      validFrom: "2026-01-01",
      createdBy: zaklad.adminId,
    });
  }

  test("výdaj s adjustmentId prejde a pripíše sa ako rework náklad", async () => {
    const { davka, adjustmentId } = await zamietnutaDavka();
    await seedZasoba();

    const { pohyby } = await vydajNavazkuDavky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      polozky: [{ materialId: zaklad.material.id, qty: "3.000" }],
      adjustmentId,
    });
    expect(pohyby[0].adjustmentId).toBe(adjustmentId);

    // v_batch_costs: výdaj s adjustment_id vstupuje do rework_material_cents
    // (3 kg × 0,50 € = 150 centov).
    const vysledok = await db.execute(
      sql`SELECT rework_material_cents FROM v_batch_costs WHERE batch_id = ${davka.id}`,
    );
    const rows = (
      Array.isArray(vysledok) ? vysledok : (vysledok as { rows: unknown }).rows
    ) as { rework_material_cents: string | number }[];
    expect(Number(rows[0].rework_material_cents)).toBe(150);
  });

  test("výdaj bez adjustmentId v stave zamietnuta → uzamknuté", async () => {
    const { davka } = await zamietnutaDavka("V-2026-0031");
    await seedZasoba();
    await expect(
      vydajNavazkuDavky(db, {
        userId: zaklad.adminId,
        batchId: davka.id,
        polozky: [{ materialId: zaklad.material.id, qty: "3.000" }],
      }),
    ).rejects.toThrow(/uzamknut|stav/i);
  });

  test("práca s adjustmentId v stave zamietnuta prejde", async () => {
    const { davka, adjustmentId } = await zamietnutaDavka("V-2026-0032");
    await seedSadzba();
    const zaznam = await pridajPracu(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      workerId: zaklad.pracovnik.id,
      workDate: "2026-07-12",
      hours: "2.00",
      adjustmentId,
    });
    expect(zaznam.adjustmentId).toBe(adjustmentId);
  });

  test("cudzí adjustment (iná dávka) → chyba", async () => {
    const { davka } = await zamietnutaDavka("V-2026-0033");
    const { adjustmentId: cudziAdj } = await zamietnutaDavka("V-2026-0034");
    await seedZasoba();
    await expect(
      vydajNavazkuDavky(db, {
        userId: zaklad.adminId,
        batchId: davka.id,
        polozky: [{ materialId: zaklad.material.id, qty: "3.000" }],
        adjustmentId: cudziAdj,
      }),
    ).rejects.toThrow(/úprav|rework|dávk/i);
  });

  test("odovzdajNaLabak zo zamietnuta → caka_na_labak (rework kolo)", async () => {
    const { davka } = await zamietnutaDavka("V-2026-0035");
    const po = await odovzdajNaLabak(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      outputKg: "101.000",
    });
    expect(po.status).toBe("caka_na_labak");
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
