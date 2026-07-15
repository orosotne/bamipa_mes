// M5 Labák — čítacie queries (fronta dávok, detail s históriou, SPC trendy,
// aktívna úprava/rework). DI DbClient. Zobrazovacie formátovanie robí UI.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

// ─────────────────────────────────────────────── fronta dávok na meranie ──

export type FrontaRiadok = {
  id: string;
  batchNumber: string;
  mixtureCode: string;
  mixtureName: string;
  outputKg: string | null;
  productionDate: string;
  shift: string;
  /** počet doterajších testov dávky (>0 = opakovaný test po úprave) */
  pocetTestov: number;
};

/** Dávky v stave „čaká na labák", najstaršie prvé. */
export async function frontaDavok(db: DbClient): Promise<FrontaRiadok[]> {
  return db
    .select({
      id: schema.productionBatches.id,
      batchNumber: schema.productionBatches.batchNumber,
      mixtureCode: schema.mixtures.code,
      mixtureName: schema.mixtures.name,
      outputKg: schema.productionBatches.outputKg,
      productionDate: schema.productionBatches.productionDate,
      shift: schema.productionBatches.shift,
      pocetTestov: sql<number>`(
        SELECT count(*)::int FROM lab_tests lt
        WHERE lt.batch_id = production_batches.id AND lt.deleted_at IS NULL
      )`,
    })
    .from(schema.productionBatches)
    .innerJoin(
      schema.recipes,
      eq(schema.recipes.id, schema.productionBatches.recipeId),
    )
    .innerJoin(
      schema.mixtures,
      eq(schema.mixtures.id, schema.recipes.mixtureId),
    )
    .where(eq(schema.productionBatches.status, "caka_na_labak"))
    .orderBy(
      asc(schema.productionBatches.productionDate),
      asc(schema.productionBatches.batchNumber),
    );
}

// ───────────────────────────────────────────────── detail dávky pre labák ──

export type DefiniciaRiadok = {
  parameterId: string;
  code: string;
  name: string;
  unit: string | null;
  sortOrder: number;
  minValue: string | null;
  maxValue: string | null;
};

export type VysledokDetail = {
  parameterId: string;
  parameterCode: string;
  parameterName: string;
  parameterUnit: string | null;
  sortOrder: number;
  value: string;
  minLimitSnapshot: string | null;
  maxLimitSnapshot: string | null;
  isWithinLimits: boolean;
};

export type TestDetail = {
  id: string;
  sequenceNo: number;
  verdict: "schvalene" | "zamietnute" | null;
  verdictAt: Date | null;
  verdictByName: string | null;
  laborantName: string;
  createdAt: Date;
  note: string | null;
  vysledky: VysledokDetail[];
};

export type DetailPreLabak = {
  davka: typeof schema.productionBatches.$inferSelect;
  mixtureId: string;
  mixtureCode: string;
  mixtureName: string;
  recipeVersion: number;
  /** aktívne definované parametre (predvyplnenie formulára merania) */
  definicie: DefiniciaRiadok[];
  /** história testov (sequence_no ASC) s výsledkami */
  testy: TestDetail[];
  poslednaUprava:
    | {
        id: string;
        description: string | null;
        createdAt: Date;
        triggeredBySequenceNo: number | null;
      }
    | null;
};

export async function detailPreLabak(
  db: DbClient,
  batchId: string,
): Promise<DetailPreLabak> {
  const [hlavicka] = await db
    .select({
      davka: schema.productionBatches,
      mixtureId: schema.mixtures.id,
      mixtureCode: schema.mixtures.code,
      mixtureName: schema.mixtures.name,
      recipeVersion: schema.recipes.version,
    })
    .from(schema.productionBatches)
    .innerJoin(
      schema.recipes,
      eq(schema.recipes.id, schema.productionBatches.recipeId),
    )
    .innerJoin(schema.mixtures, eq(schema.mixtures.id, schema.recipes.mixtureId))
    .where(eq(schema.productionBatches.id, batchId));
  if (!hlavicka) throw new Error("Dávka neexistuje.");

  const definicie = await db
    .select({
      parameterId: schema.labParameters.id,
      code: schema.labParameters.code,
      name: schema.labParameters.name,
      unit: schema.labParameters.unit,
      sortOrder: schema.labParameters.sortOrder,
      minValue: schema.labTestDefinitions.minValue,
      maxValue: schema.labTestDefinitions.maxValue,
    })
    .from(schema.labTestDefinitions)
    .innerJoin(
      schema.labParameters,
      eq(schema.labParameters.id, schema.labTestDefinitions.parameterId),
    )
    .where(
      and(
        eq(schema.labTestDefinitions.mixtureId, hlavicka.mixtureId),
        eq(schema.labTestDefinitions.isActive, true),
        isNull(schema.labTestDefinitions.deletedAt),
      ),
    )
    .orderBy(asc(schema.labParameters.sortOrder));

  // Testy s menom laboranta (created_by) a verdiktujúceho (verdict_by).
  const testyRaw = await db
    .select({
      id: schema.labTests.id,
      sequenceNo: schema.labTests.sequenceNo,
      verdict: schema.labTests.verdict,
      verdictAt: schema.labTests.verdictAt,
      createdAt: schema.labTests.createdAt,
      note: schema.labTests.note,
      laborantName: schema.users.displayName,
      verdictByName: sql<
        string | null
      >`(SELECT display_name FROM users u WHERE u.id = ${schema.labTests.verdictBy})`,
    })
    .from(schema.labTests)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.labTests.createdBy),
    )
    .where(
      and(
        eq(schema.labTests.batchId, batchId),
        isNull(schema.labTests.deletedAt),
      ),
    )
    .orderBy(asc(schema.labTests.sequenceNo));

  // Výsledky všetkých testov naraz + zoskupenie v JS (žiadny N+1).
  const testIds = testyRaw.map((t) => t.id);
  const vysledkyRaw = testIds.length
    ? await db
        .select({
          labTestId: schema.labResults.labTestId,
          parameterId: schema.labResults.parameterId,
          parameterCode: schema.labParameters.code,
          parameterName: schema.labParameters.name,
          parameterUnit: schema.labParameters.unit,
          sortOrder: schema.labParameters.sortOrder,
          value: schema.labResults.value,
          minLimitSnapshot: schema.labResults.minLimitSnapshot,
          maxLimitSnapshot: schema.labResults.maxLimitSnapshot,
          isWithinLimits: schema.labResults.isWithinLimits,
        })
        .from(schema.labResults)
        .innerJoin(
          schema.labParameters,
          eq(schema.labParameters.id, schema.labResults.parameterId),
        )
        .where(inArray(schema.labResults.labTestId, testIds))
        .orderBy(asc(schema.labParameters.sortOrder))
    : [];

  const testy: TestDetail[] = testyRaw.map((t) => ({
    id: t.id,
    sequenceNo: t.sequenceNo,
    verdict: t.verdict,
    verdictAt: t.verdictAt,
    verdictByName: t.verdictByName,
    laborantName: t.laborantName,
    createdAt: t.createdAt,
    note: t.note,
    vysledky: vysledkyRaw
      .filter((v) => v.labTestId === t.id)
      .map((v) => ({
        parameterId: v.parameterId,
        parameterCode: v.parameterCode,
        parameterName: v.parameterName,
        parameterUnit: v.parameterUnit,
        sortOrder: v.sortOrder,
        value: v.value,
        minLimitSnapshot: v.minLimitSnapshot,
        maxLimitSnapshot: v.maxLimitSnapshot,
        isWithinLimits: v.isWithinLimits,
      })),
  }));

  const [uprava] = await db
    .select({
      id: schema.batchAdjustments.id,
      description: schema.batchAdjustments.description,
      createdAt: schema.batchAdjustments.createdAt,
      triggeredBySequenceNo: schema.labTests.sequenceNo,
    })
    .from(schema.batchAdjustments)
    .leftJoin(
      schema.labTests,
      eq(schema.labTests.id, schema.batchAdjustments.triggeredByLabTestId),
    )
    .where(
      and(
        eq(schema.batchAdjustments.batchId, batchId),
        isNull(schema.batchAdjustments.deletedAt),
      ),
    )
    .orderBy(desc(schema.batchAdjustments.createdAt))
    .limit(1);

  return {
    davka: hlavicka.davka,
    mixtureId: hlavicka.mixtureId,
    mixtureCode: hlavicka.mixtureCode,
    mixtureName: hlavicka.mixtureName,
    recipeVersion: hlavicka.recipeVersion,
    definicie,
    testy,
    poslednaUprava: uprava ?? null,
  };
}

// ─────────────────────────────────────────────────── SPC trend parametra ──

export type TrendBod = {
  value: string;
  isWithinLimits: boolean;
  minLimitSnapshot: string | null;
  maxLimitSnapshot: string | null;
  meraniaCas: Date;
  sequenceNo: number;
  batchNumber: string;
  productionDate: string;
};

export type Trend = {
  body: TrendBod[];
  /** aktuálne aktívne limity zmesi pre parameter (referenčné čiary) */
  limity: { minValue: string | null; maxValue: string | null } | null;
};

/** Časový rad nameraných hodnôt parametra pre zmes + aktuálne limity. */
export async function trendParametra(
  db: DbClient,
  vstup: { mixtureId: string; parameterId: string },
): Promise<Trend> {
  const body = await db
    .select({
      value: schema.labResults.value,
      isWithinLimits: schema.labResults.isWithinLimits,
      minLimitSnapshot: schema.labResults.minLimitSnapshot,
      maxLimitSnapshot: schema.labResults.maxLimitSnapshot,
      meraniaCas: schema.labTests.createdAt,
      sequenceNo: schema.labTests.sequenceNo,
      batchNumber: schema.productionBatches.batchNumber,
      productionDate: schema.productionBatches.productionDate,
    })
    .from(schema.labResults)
    .innerJoin(
      schema.labTests,
      eq(schema.labTests.id, schema.labResults.labTestId),
    )
    .innerJoin(
      schema.productionBatches,
      eq(schema.productionBatches.id, schema.labTests.batchId),
    )
    .innerJoin(
      schema.recipes,
      eq(schema.recipes.id, schema.productionBatches.recipeId),
    )
    .where(
      and(
        eq(schema.recipes.mixtureId, vstup.mixtureId),
        eq(schema.labResults.parameterId, vstup.parameterId),
        isNull(schema.labTests.deletedAt),
      ),
    )
    .orderBy(
      asc(schema.productionBatches.productionDate),
      asc(schema.labTests.createdAt),
      asc(schema.labTests.sequenceNo),
    );

  const [limity] = await db
    .select({
      minValue: schema.labTestDefinitions.minValue,
      maxValue: schema.labTestDefinitions.maxValue,
    })
    .from(schema.labTestDefinitions)
    .where(
      and(
        eq(schema.labTestDefinitions.mixtureId, vstup.mixtureId),
        eq(schema.labTestDefinitions.parameterId, vstup.parameterId),
        eq(schema.labTestDefinitions.isActive, true),
        isNull(schema.labTestDefinitions.deletedAt),
      ),
    );

  return { body, limity: limity ?? null };
}

// ──────────────────────────────────────────── aktívna úprava (rework) ──

export type ReworkVydaj = {
  id: string;
  materialCode: string;
  materialName: string;
  qtyDelta: string;
  unitPrice: string;
  createdAt: Date;
};

export type ReworkPraca = typeof schema.batchLabor.$inferSelect & {
  workerName: string;
};

export type AktivnaUprava = {
  adjustment: typeof schema.batchAdjustments.$inferSelect;
  triggeredBySequenceNo: number | null;
  vydaje: ReworkVydaj[];
  praca: ReworkPraca[];
} | null;

/** Posledná úprava dávky (rework) + jej dodatočné výdaje a práca. */
export async function aktivnaUprava(
  db: DbClient,
  batchId: string,
): Promise<AktivnaUprava> {
  const [adjustment] = await db
    .select()
    .from(schema.batchAdjustments)
    .where(
      and(
        eq(schema.batchAdjustments.batchId, batchId),
        isNull(schema.batchAdjustments.deletedAt),
      ),
    )
    .orderBy(desc(schema.batchAdjustments.createdAt))
    .limit(1);
  if (!adjustment) return null;

  const [trigger] = await db
    .select({ sequenceNo: schema.labTests.sequenceNo })
    .from(schema.labTests)
    .where(eq(schema.labTests.id, adjustment.triggeredByLabTestId));

  const vydaje = await db
    .select({
      id: schema.stockMoves.id,
      materialCode: schema.materials.code,
      materialName: schema.materials.name,
      qtyDelta: schema.stockMoves.qtyDelta,
      unitPrice: schema.stockMoves.unitPrice,
      createdAt: schema.stockMoves.createdAt,
    })
    .from(schema.stockMoves)
    .innerJoin(
      schema.materialLots,
      eq(schema.materialLots.id, schema.stockMoves.lotId),
    )
    .innerJoin(
      schema.materials,
      eq(schema.materials.id, schema.materialLots.materialId),
    )
    .where(eq(schema.stockMoves.adjustmentId, adjustment.id))
    .orderBy(asc(schema.stockMoves.createdAt));

  const praca = await db
    .select({
      id: schema.batchLabor.id,
      batchId: schema.batchLabor.batchId,
      workerId: schema.batchLabor.workerId,
      workDate: schema.batchLabor.workDate,
      hours: schema.batchLabor.hours,
      hourlyRateCents: schema.batchLabor.hourlyRateCents,
      adjustmentId: schema.batchLabor.adjustmentId,
      note: schema.batchLabor.note,
      createdAt: schema.batchLabor.createdAt,
      updatedAt: schema.batchLabor.updatedAt,
      createdBy: schema.batchLabor.createdBy,
      deletedAt: schema.batchLabor.deletedAt,
      workerName: schema.workers.fullName,
    })
    .from(schema.batchLabor)
    .innerJoin(
      schema.workers,
      eq(schema.workers.id, schema.batchLabor.workerId),
    )
    .where(
      and(
        eq(schema.batchLabor.adjustmentId, adjustment.id),
        isNull(schema.batchLabor.deletedAt),
      ),
    )
    .orderBy(asc(schema.batchLabor.createdAt));

  return {
    adjustment,
    triggeredBySequenceNo: trigger?.sequenceNo ?? null,
    vydaje,
    praca,
  };
}
