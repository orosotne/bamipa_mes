// Čítacie queries dávok (M4): zoznam + detail (plán vs. skutočnosť, náklady).
// Plán navážky sa počíta cez teoretickaKalkulacia (M3) — jej polozky[].qtyKg
// JE presne recipe_items.qtyKg × davka.scaleFactor (zdieľaná logika, žiadna
// druhá implementácia škálovania).
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { teoretickaKalkulacia, type TeoretickaKalkulacia } from "@/server/inventory/theoretical";

export type RiadokZoznamuDavok = {
  id: string;
  batchNumber: string;
  status: (typeof schema.batchStatus.enumValues)[number];
  productionDate: string;
  shift: string;
  mixtureCode: string;
  mixtureName: string;
  machineCode: string;
  leadWorkerName: string;
};

export async function zoznamDavok(db: DbClient): Promise<RiadokZoznamuDavok[]> {
  return db
    .select({
      id: schema.productionBatches.id,
      batchNumber: schema.productionBatches.batchNumber,
      status: schema.productionBatches.status,
      productionDate: schema.productionBatches.productionDate,
      shift: schema.productionBatches.shift,
      mixtureCode: schema.mixtures.code,
      mixtureName: schema.mixtures.name,
      machineCode: schema.machines.code,
      leadWorkerName: schema.workers.fullName,
    })
    .from(schema.productionBatches)
    .innerJoin(schema.recipes, eq(schema.productionBatches.recipeId, schema.recipes.id))
    .innerJoin(schema.mixtures, eq(schema.recipes.mixtureId, schema.mixtures.id))
    .innerJoin(schema.machines, eq(schema.productionBatches.machineId, schema.machines.id))
    .innerJoin(schema.workers, eq(schema.productionBatches.leadWorkerId, schema.workers.id))
    .where(isNull(schema.productionBatches.deletedAt))
    .orderBy(
      desc(schema.productionBatches.productionDate),
      desc(schema.productionBatches.batchNumber),
    );
}

export type PohybNavazky = {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  moveType: (typeof schema.stockMoveType.enumValues)[number];
  qtyDelta: string;
  unitPrice: string;
  lotId: string;
  adjustmentId: string | null;
  reversedMoveId: string | null;
  createdAt: Date;
};

export type SkutocnaPolozka = {
  materialId: string;
  materialCode: string;
  materialName: string;
  /** Σ(-qty_delta) pre materiál na dávke — čistá skutočná spotreba (numeric string) */
  skutQtyKg: string;
};

export type PracaRiadok = typeof schema.batchLabor.$inferSelect & {
  workerName: string;
};

export type PrestojRiadok = typeof schema.batchDowntimes.$inferSelect & {
  reasonName: string;
};

export type NakladyDavky = {
  materialCents: number;
  laborCents: number;
  reworkMaterialCents: number;
  reworkLaborCents: number;
  totalCents: number;
  costPerKgCents: number | null;
};

export type DetailDavky = {
  davka: typeof schema.productionBatches.$inferSelect;
  mixtureCode: string;
  mixtureName: string;
  recipeVersion: number;
  machineName: string;
  leadWorkerName: string;
  planKalkulacia: TeoretickaKalkulacia;
  pohyby: PohybNavazky[];
  skutocnePolozky: SkutocnaPolozka[];
  praca: PracaRiadok[];
  prestoje: PrestojRiadok[];
  naklady: NakladyDavky | null;
};

export async function detailDavky(
  db: DbClient,
  batchId: string,
): Promise<DetailDavky> {
  const [davka] = await db
    .select()
    .from(schema.productionBatches)
    .where(eq(schema.productionBatches.id, batchId));
  if (!davka) {
    throw new Error("Dávka neexistuje.");
  }

  const [hlavicka] = await db
    .select({
      mixtureCode: schema.mixtures.code,
      mixtureName: schema.mixtures.name,
      recipeVersion: schema.recipes.version,
      machineName: schema.machines.name,
      leadWorkerName: schema.workers.fullName,
    })
    .from(schema.recipes)
    .innerJoin(schema.mixtures, eq(schema.recipes.mixtureId, schema.mixtures.id))
    .innerJoin(schema.machines, eq(schema.machines.id, davka.machineId))
    .innerJoin(schema.workers, eq(schema.workers.id, davka.leadWorkerId))
    .where(eq(schema.recipes.id, davka.recipeId));

  const planKalkulacia = await teoretickaKalkulacia(db, {
    recipeId: davka.recipeId,
    scaleFactor: davka.scaleFactor,
  });

  const pohyby = await db
    .select({
      id: schema.stockMoves.id,
      materialId: schema.materials.id,
      materialCode: schema.materials.code,
      materialName: schema.materials.name,
      moveType: schema.stockMoves.moveType,
      qtyDelta: schema.stockMoves.qtyDelta,
      unitPrice: schema.stockMoves.unitPrice,
      lotId: schema.stockMoves.lotId,
      adjustmentId: schema.stockMoves.adjustmentId,
      reversedMoveId: schema.stockMoves.reversedMoveId,
      createdAt: schema.stockMoves.createdAt,
    })
    .from(schema.stockMoves)
    .innerJoin(schema.materialLots, eq(schema.stockMoves.lotId, schema.materialLots.id))
    .innerJoin(schema.materials, eq(schema.materialLots.materialId, schema.materials.id))
    .where(eq(schema.stockMoves.batchId, batchId))
    .orderBy(schema.stockMoves.createdAt);

  const skutocnePolozky = await db
    .select({
      materialId: schema.materials.id,
      materialCode: schema.materials.code,
      materialName: schema.materials.name,
      skutQtyKg: sql<string>`(sum(-${schema.stockMoves.qtyDelta}))::numeric(14,3)`,
    })
    .from(schema.stockMoves)
    .innerJoin(schema.materialLots, eq(schema.stockMoves.lotId, schema.materialLots.id))
    .innerJoin(schema.materials, eq(schema.materialLots.materialId, schema.materials.id))
    .where(eq(schema.stockMoves.batchId, batchId))
    .groupBy(schema.materials.id, schema.materials.code, schema.materials.name);

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
    .innerJoin(schema.workers, eq(schema.batchLabor.workerId, schema.workers.id))
    .where(
      and(eq(schema.batchLabor.batchId, batchId), isNull(schema.batchLabor.deletedAt)),
    );

  const prestoje = await db
    .select({
      id: schema.batchDowntimes.id,
      batchId: schema.batchDowntimes.batchId,
      reasonId: schema.batchDowntimes.reasonId,
      minutes: schema.batchDowntimes.minutes,
      note: schema.batchDowntimes.note,
      createdAt: schema.batchDowntimes.createdAt,
      updatedAt: schema.batchDowntimes.updatedAt,
      createdBy: schema.batchDowntimes.createdBy,
      deletedAt: schema.batchDowntimes.deletedAt,
      reasonName: schema.downtimeReasons.name,
    })
    .from(schema.batchDowntimes)
    .innerJoin(
      schema.downtimeReasons,
      eq(schema.batchDowntimes.reasonId, schema.downtimeReasons.id),
    )
    .where(
      and(
        eq(schema.batchDowntimes.batchId, batchId),
        isNull(schema.batchDowntimes.deletedAt),
      ),
    );

  type NakladyRow = {
    material_cents: string | number;
    labor_cents: string | number;
    rework_material_cents: string | number;
    rework_labor_cents: string | number;
    total_cents: string | number;
    cost_per_kg_cents: string | number | null;
  };
  const nakladyResult = await db.execute(
    sql`SELECT material_cents, labor_cents, rework_material_cents,
               rework_labor_cents, total_cents, cost_per_kg_cents
        FROM v_batch_costs WHERE batch_id = ${batchId}`,
  );
  // Tvar výsledku sa líši podľa drivera: drizzle-orm/postgres-js (dev/prod)
  // vracia pole priamo, drizzle-orm/pglite (testy) ho balí do { rows }.
  const nakladyRows = (
    Array.isArray(nakladyResult) ? nakladyResult : (nakladyResult as { rows: unknown }).rows
  ) as NakladyRow[];
  const nakladyRow = nakladyRows[0];

  return {
    davka,
    mixtureCode: hlavicka.mixtureCode,
    mixtureName: hlavicka.mixtureName,
    recipeVersion: hlavicka.recipeVersion,
    machineName: hlavicka.machineName,
    leadWorkerName: hlavicka.leadWorkerName,
    planKalkulacia,
    pohyby,
    skutocnePolozky,
    praca,
    prestoje,
    naklady: nakladyRow
      ? {
          materialCents: Number(nakladyRow.material_cents),
          laborCents: Number(nakladyRow.labor_cents),
          reworkMaterialCents: Number(nakladyRow.rework_material_cents),
          reworkLaborCents: Number(nakladyRow.rework_labor_cents),
          totalCents: Number(nakladyRow.total_cents),
          costPerKgCents:
            nakladyRow.cost_per_kg_cents === null
              ? null
              : Number(nakladyRow.cost_per_kg_cents),
        }
      : null,
  };
}
