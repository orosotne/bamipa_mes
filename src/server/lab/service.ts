// M5 Labák — meranie a verdikt (QC brána). DI DbClient, slovenské doménové chyby,
// audit_log. Stavový automat dávky (caka_na_labak → schvalena/zamietnuta;
// zamietnuta → caka_na_labak rework) vynucuje DB trigger
// (0001_rls_triggers_guards.sql) — táto vrstva pridáva app-level validáciu a
// audit; slovenské hlášky triggera sa propagujú bez zabalenia (SPEC §12).
import { and, desc, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { sqlState } from "@/server/action-utils";
import { formatQty, parseQty } from "@/server/inventory/money";

const MAX_POKUSY = 3;

/** Nameraná hodnota → { milli (×10³ pre presné porovnanie), kanon numeric(10,3) }. */
function pripravHodnotu(input: string): { milli: bigint; kanon: string } {
  const t = String(input).replace(/[\s ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,3})?$/.test(t)) {
    throw new Error(`Neplatná nameraná hodnota: „${input}".`);
  }
  const milli = parseQty(t);
  return { milli, kanon: formatQty(milli) };
}

function jeVLimite(
  value: bigint,
  minLimit: string | null,
  maxLimit: string | null,
): boolean {
  if (minLimit !== null && value < parseQty(minLimit)) return false;
  if (maxLimit !== null && value > parseQty(maxLimit)) return false;
  return true;
}

export type VysledokMerania = {
  test: typeof schema.labTests.$inferSelect;
  results: (typeof schema.labResults.$inferSelect)[];
};

/**
 * Zápis merania dávky: vytvorí lab_test so sequence_no (INSERT … SELECT max+1,
 * retry 23505 pri súbehu) a lab_results so snapshotmi limitov z definícií zmesi
 * (is_within_limits vyhodnotené pri zápise). Vyžaduje dávku v stave
 * caka_na_labak, kompletné pokrytie práve definovaných parametrov a žiadne
 * rozpracované meranie bez verdiktu.
 */
export async function zapisMerania(
  db: DbClient,
  vstup: {
    userId: string;
    batchId: string;
    merania: { parameterId: string; value: string }[];
    note?: string;
  },
): Promise<VysledokMerania> {
  if (vstup.merania.length === 0) {
    throw new Error("Meranie musí obsahovať aspoň jeden parameter.");
  }
  // Predvalidácia formátu hodnôt (fail-fast, mimo transakcie).
  const hodnoty = new Map<string, { milli: bigint; kanon: string }>();
  for (const m of vstup.merania) {
    if (hodnoty.has(m.parameterId)) {
      throw new Error("Parameter sa v meraní opakuje.");
    }
    hodnoty.set(m.parameterId, pripravHodnotu(m.value));
  }

  let poslednaChyba: unknown;
  for (let pokus = 1; pokus <= MAX_POKUSY; pokus++) {
    try {
      return await zapisMeraniaRaz(db, vstup, hodnoty);
    } catch (e) {
      if (sqlState(e) !== "23505") throw e;
      poslednaChyba = e;
    }
  }
  throw poslednaChyba;
}

async function zapisMeraniaRaz(
  db: DbClient,
  vstup: {
    userId: string;
    batchId: string;
    merania: { parameterId: string; value: string }[];
    note?: string;
  },
  hodnoty: Map<string, { milli: bigint; kanon: string }>,
): Promise<VysledokMerania> {
  return db.transaction(async (tx) => {
    const [davka] = await tx
      .select({
        status: schema.productionBatches.status,
        recipeId: schema.productionBatches.recipeId,
      })
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.id, vstup.batchId));
    if (!davka) throw new Error("Dávka neexistuje.");
    if (davka.status !== "caka_na_labak") {
      throw new Error(
        `Merať možno len dávku v stave „čaká na labák" (stav dávky: „${davka.status}").`,
      );
    }

    const [recept] = await tx
      .select({ mixtureId: schema.recipes.mixtureId })
      .from(schema.recipes)
      .where(eq(schema.recipes.id, davka.recipeId));

    const definicie = await tx
      .select({
        parameterId: schema.labTestDefinitions.parameterId,
        minValue: schema.labTestDefinitions.minValue,
        maxValue: schema.labTestDefinitions.maxValue,
      })
      .from(schema.labTestDefinitions)
      .where(
        and(
          eq(schema.labTestDefinitions.mixtureId, recept.mixtureId),
          eq(schema.labTestDefinitions.isActive, true),
          isNull(schema.labTestDefinitions.deletedAt),
        ),
      );
    if (definicie.length === 0) {
      throw new Error(
        "Zmes nemá definované limity labáku — najprv ich nastav v Receptúrach.",
      );
    }

    // Meranie musí pokryť PRÁVE definované parametre (nie menej, nie viac).
    const defIds = new Set(definicie.map((d) => d.parameterId));
    if (
      hodnoty.size !== defIds.size ||
      ![...defIds].every((id) => hodnoty.has(id))
    ) {
      throw new Error(
        "Meranie musí obsahovať práve všetky definované parametre zmesi.",
      );
    }

    // Najviac jedno rozpracované meranie bez verdiktu na dávku.
    const [otvoreny] = await tx
      .select({ id: schema.labTests.id })
      .from(schema.labTests)
      .where(
        and(
          eq(schema.labTests.batchId, vstup.batchId),
          isNull(schema.labTests.verdict),
          isNull(schema.labTests.deletedAt),
        ),
      );
    if (otvoreny) {
      throw new Error(
        "Dávka už má rozpracované meranie bez verdiktu — najprv vynes verdikt.",
      );
    }

    // sequence_no atomicky: INSERT … SELECT max+1 (vrátane zmazaných — unique
    // je plný). Súbeh zachytí unique index → retry 23505 vo volajúcom.
    const inserted = await tx.execute(
      sql`INSERT INTO lab_tests (batch_id, sequence_no, note, created_by)
          SELECT ${vstup.batchId},
                 coalesce(max(sequence_no), 0) + 1,
                 ${vstup.note ?? null},
                 ${vstup.userId}
          FROM lab_tests WHERE batch_id = ${vstup.batchId}
          RETURNING id`,
    );
    const insertedRows = (
      Array.isArray(inserted) ? inserted : (inserted as { rows: unknown }).rows
    ) as { id: string }[];
    const testId = insertedRows[0].id;

    const [test] = await tx
      .select()
      .from(schema.labTests)
      .where(eq(schema.labTests.id, testId));

    const results: (typeof schema.labResults.$inferSelect)[] = [];
    for (const def of definicie) {
      const h = hodnoty.get(def.parameterId)!;
      const [row] = await tx
        .insert(schema.labResults)
        .values({
          labTestId: testId,
          parameterId: def.parameterId,
          value: h.kanon,
          minLimitSnapshot: def.minValue,
          maxLimitSnapshot: def.maxValue,
          isWithinLimits: jeVLimite(h.milli, def.minValue, def.maxValue),
          createdBy: vstup.userId,
        })
        .returning();
      results.push(row);
    }

    await tx.insert(schema.auditLog).values({
      tableName: "lab_tests",
      recordId: testId,
      action: "insert",
      changedBy: vstup.userId,
      changes: {
        new: { sequenceNo: test.sequenceNo, pocetVysledkov: results.length },
      },
    });

    return { test, results };
  });
}

export type VysledokVerdiktu = {
  test: typeof schema.labTests.$inferSelect;
  adjustmentId: string | null;
};

/**
 * Vynesenie verdiktu posledného merania dávky. Zapíše verdict + verdict_by +
 * verdict_at (naraz — CHECK lab_tests_verdict_signed) a v tej istej transakcii
 * posunie stav dávky (schvalene → schvalena, zamietnute → zamietnuta). Pri
 * zamietnutí vytvorí batch_adjustments (rework — labák iniciuje úpravu dávky,
 * SPEC §2.2); vyžaduje inštrukciu na úpravu.
 */
export async function vynesVerdikt(
  db: DbClient,
  vstup: {
    userId: string;
    labTestId: string;
    verdict: "schvalene" | "zamietnute";
    /** povinná pri verdikte zamietnute */
    instrukcia?: string;
  },
): Promise<VysledokVerdiktu> {
  const instrukcia = vstup.instrukcia?.trim();
  if (vstup.verdict === "zamietnute" && !instrukcia) {
    throw new Error(
      "Zamietnutie vyžaduje inštrukciu na úpravu dávky (čo doplniť/upraviť).",
    );
  }

  return db.transaction(async (tx) => {
    const [test] = await tx
      .select()
      .from(schema.labTests)
      .where(eq(schema.labTests.id, vstup.labTestId));
    if (!test) throw new Error("Meranie neexistuje.");
    if (test.verdict !== null) {
      throw new Error("Meranie už má vynesený verdikt.");
    }

    // Verdikt sa vynáša len na POSLEDNOM meraní dávky.
    const [posledny] = await tx
      .select({ id: schema.labTests.id })
      .from(schema.labTests)
      .where(
        and(
          eq(schema.labTests.batchId, test.batchId),
          isNull(schema.labTests.deletedAt),
        ),
      )
      .orderBy(desc(schema.labTests.sequenceNo))
      .limit(1);
    if (posledny.id !== test.id) {
      throw new Error(
        "Verdikt možno vyniesť len na poslednom meraní dávky.",
      );
    }

    const [aktualizovany] = await tx
      .update(schema.labTests)
      .set({
        verdict: vstup.verdict,
        verdictBy: vstup.userId,
        verdictAt: new Date(),
      })
      .where(eq(schema.labTests.id, vstup.labTestId))
      .returning();

    const novyStav = vstup.verdict === "schvalene" ? "schvalena" : "zamietnuta";
    // DB trigger overí, že posledný verdikt zodpovedá cieľovému stavu (§12).
    await tx
      .update(schema.productionBatches)
      .set({ status: novyStav })
      .where(eq(schema.productionBatches.id, test.batchId));

    let adjustmentId: string | null = null;
    if (vstup.verdict === "zamietnute") {
      const [adj] = await tx
        .insert(schema.batchAdjustments)
        .values({
          batchId: test.batchId,
          triggeredByLabTestId: vstup.labTestId,
          description: instrukcia,
          createdBy: vstup.userId,
        })
        .returning();
      adjustmentId = adj.id;
    }

    await tx.insert(schema.auditLog).values({
      tableName: "production_batches",
      recordId: test.batchId,
      action: "status_change",
      changedBy: vstup.userId,
      changes: {
        new: { status: novyStav, verdict: vstup.verdict, labTestId: vstup.labTestId },
      },
    });

    return { test: aktualizovany, adjustmentId };
  });
}
