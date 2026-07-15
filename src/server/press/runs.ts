// Výkony lisovania (M6). Tvrdú väzbu na SCHVÁLENÉ dávky, zhodu zmesi,
// rozpočet kg dávky a immutabilitu väzieb vynucuje DB trigger press_runs_guard
// (0004) — jeho slovenské hlášky sa zámerne nezabaľujú a propagujú surové.
// Služba dopĺňa app-checky s lepšou UX hláškou (stredisko stroja, duplicity).
import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

export type VysledokVykonu = {
  run: typeof schema.pressRuns.$inferSelect;
  defects: (typeof schema.pressRunDefects.$inferSelect)[];
  downtimes: (typeof schema.pressRunDowntimes.$inferSelect)[];
};

export async function zapisVykon(
  db: DbClient,
  vstup: {
    userId: string;
    workOrderId: string;
    machineId: string;
    batchId: string;
    /** "YYYY-MM-DD" */
    runDate: string;
    shift: string;
    cyclesCount: number;
    /** DOBRÉ páry po výstupnej kontrole; nepodarky zvlášť. */
    pairsProduced: number;
    /** numeric(12,3) string — spotreba zmesi */
    mixtureKg: string;
    workerId: string;
    note?: string;
    nepodarky?: { defectReasonId: string; qtyPairs: number }[];
    prestoje?: { reasonId: string; minutes: number; note?: string }[];
  },
): Promise<VysledokVykonu> {
  if (!Number.isInteger(vstup.cyclesCount) || vstup.cyclesCount <= 0) {
    throw new Error("Počet cyklov musí byť kladné celé číslo.");
  }
  if (!Number.isInteger(vstup.pairsProduced) || vstup.pairsProduced < 0) {
    throw new Error("Vyrobené páry nesmú byť záporné.");
  }
  const kg = Number(vstup.mixtureKg);
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error("Spotreba zmesi musí byť kladná.");
  }
  const nepodarky = vstup.nepodarky ?? [];
  const videneDovody = new Set<string>();
  for (const n of nepodarky) {
    if (videneDovody.has(n.defectReasonId)) {
      throw new Error("Dôvod nepodarku sa vo výkone opakuje.");
    }
    videneDovody.add(n.defectReasonId);
    if (!Number.isInteger(n.qtyPairs) || n.qtyPairs <= 0) {
      throw new Error("Počet nepodarkov musí byť kladné celé číslo.");
    }
  }
  const prestoje = vstup.prestoje ?? [];
  for (const p of prestoje) {
    if (!Number.isInteger(p.minutes) || p.minutes <= 0) {
      throw new Error("Trvanie prestoja musí byť kladné.");
    }
  }

  // Stroj musí patriť stredisku lisovňa (číselník machines je zdieľaný s M4).
  const [stroj] = await db
    .select({ costCenterCode: schema.costCenters.code })
    .from(schema.machines)
    .innerJoin(
      schema.costCenters,
      eq(schema.costCenters.id, schema.machines.costCenterId),
    )
    .where(
      and(
        eq(schema.machines.id, vstup.machineId),
        isNull(schema.machines.deletedAt),
      ),
    );
  if (!stroj) throw new Error("Stroj neexistuje.");
  if (stroj.costCenterCode !== "lisovna") {
    throw new Error("Výkon možno zapísať len na stroj strediska lisovňa.");
  }

  return db.transaction(async (tx) => {
    // Tvrdú väzbu (schválená dávka, zmes, rozpočet) overí trigger pri INSERTe.
    const [run] = await tx
      .insert(schema.pressRuns)
      .values({
        workOrderId: vstup.workOrderId,
        machineId: vstup.machineId,
        batchId: vstup.batchId,
        runDate: vstup.runDate,
        shift: vstup.shift,
        cyclesCount: vstup.cyclesCount,
        pairsProduced: vstup.pairsProduced,
        mixtureKg: vstup.mixtureKg,
        workerId: vstup.workerId,
        note: vstup.note ?? null,
        createdBy: vstup.userId,
      })
      .returning();

    const defects: (typeof schema.pressRunDefects.$inferSelect)[] = [];
    for (const n of nepodarky) {
      const [defect] = await tx
        .insert(schema.pressRunDefects)
        .values({
          pressRunId: run.id,
          defectReasonId: n.defectReasonId,
          qtyPairs: n.qtyPairs,
          createdBy: vstup.userId,
        })
        .returning();
      defects.push(defect);
    }

    const downtimes: (typeof schema.pressRunDowntimes.$inferSelect)[] = [];
    for (const p of prestoje) {
      const [downtime] = await tx
        .insert(schema.pressRunDowntimes)
        .values({
          pressRunId: run.id,
          reasonId: p.reasonId,
          minutes: p.minutes,
          note: p.note ?? null,
          createdBy: vstup.userId,
        })
        .returning();
      downtimes.push(downtime);
    }

    // Prvý výkon posúva príkaz nova → vo_vyrobe (podmienený UPDATE — súbeh
    // dvoch výkonov skončí no-op updatom, trigger to pustí).
    const posunuty = await tx
      .update(schema.workOrders)
      .set({ status: "vo_vyrobe" })
      .where(
        and(
          eq(schema.workOrders.id, vstup.workOrderId),
          eq(schema.workOrders.status, "nova"),
        ),
      )
      .returning({ id: schema.workOrders.id });
    if (posunuty.length > 0) {
      await tx.insert(schema.auditLog).values({
        tableName: "work_orders",
        recordId: vstup.workOrderId,
        action: "status_change",
        changedBy: vstup.userId,
        changes: { old: { status: "nova" }, new: { status: "vo_vyrobe" } },
      });
    }

    await tx.insert(schema.auditLog).values({
      tableName: "press_runs",
      recordId: run.id,
      action: "insert",
      changedBy: vstup.userId,
      changes: {
        new: {
          workOrderId: vstup.workOrderId,
          batchId: vstup.batchId,
          cyclesCount: vstup.cyclesCount,
          pairsProduced: vstup.pairsProduced,
          mixtureKg: vstup.mixtureKg,
        },
      },
    });

    return { run, defects, downtimes };
  });
}

/**
 * Storno výkonu = soft delete výkonu aj jeho detí v jednej transakcii.
 * DB trigger pri UPDATE výkonu re-checkne rozpočet dávky a expedované ≤
 * vyrobené — storno pod už expedované množstvo neprejde.
 */
export async function stornoVykon(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(schema.pressRuns)
      .where(
        and(
          eq(schema.pressRuns.id, vstup.id),
          isNull(schema.pressRuns.deletedAt),
        ),
      );
    if (!run) throw new Error("Výkon neexistuje alebo už je stornovaný.");

    const teraz = new Date();
    await tx
      .update(schema.pressRunDefects)
      .set({ deletedAt: teraz })
      .where(
        and(
          eq(schema.pressRunDefects.pressRunId, vstup.id),
          isNull(schema.pressRunDefects.deletedAt),
        ),
      );
    await tx
      .update(schema.pressRunDowntimes)
      .set({ deletedAt: teraz })
      .where(
        and(
          eq(schema.pressRunDowntimes.pressRunId, vstup.id),
          isNull(schema.pressRunDowntimes.deletedAt),
        ),
      );
    await tx
      .update(schema.pressRuns)
      .set({ deletedAt: teraz })
      .where(eq(schema.pressRuns.id, vstup.id));

    await tx.insert(schema.auditLog).values({
      tableName: "press_runs",
      recordId: vstup.id,
      action: "delete",
      changedBy: vstup.userId,
      changes: null,
    });
  });
}
