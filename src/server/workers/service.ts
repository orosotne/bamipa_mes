// Pracovníci + hodinové sadzby (M4 číselník). Vzor z M1/M2: DI DbClient,
// slovenské doménové chyby, audit_log, soft delete guard proti výrobným dávkam.
// Sadzby (labor_rates) sú append-only história (D9 kontext) — "úprava" sadzby
// znamená pridanie nového riadku s budúcim valid_from, nie prepis starého;
// batch_labor si berie snapshot sadzby k work_date, takže história ostáva
// nemenná aj pri neskoršej zmene.
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { sqlState } from "@/server/action-utils";

export type WorkerPolia = {
  fullName: string;
  isActive?: boolean;
};

function validujMeno(fullName: string): string {
  const meno = fullName.trim();
  if (!meno) throw new Error("Meno pracovníka nesmie byť prázdne.");
  return meno;
}

export async function createWorker(
  db: DbClient,
  vstup: { userId: string } & WorkerPolia,
): Promise<typeof schema.workers.$inferSelect> {
  const fullName = validujMeno(vstup.fullName);

  return db.transaction(async (tx) => {
    const [pracovnik] = await tx
      .insert(schema.workers)
      .values({
        fullName,
        isActive: vstup.isActive ?? true,
        createdBy: vstup.userId,
      })
      .returning();

    await tx.insert(schema.auditLog).values({
      tableName: "workers",
      recordId: pracovnik.id,
      action: "insert",
      changedBy: vstup.userId,
      changes: { new: { fullName } },
    });

    return pracovnik;
  });
}

export async function updateWorker(
  db: DbClient,
  vstup: { userId: string; id: string } & WorkerPolia,
): Promise<typeof schema.workers.$inferSelect> {
  const fullName = validujMeno(vstup.fullName);

  return db.transaction(async (tx) => {
    const [povodny] = await tx
      .select()
      .from(schema.workers)
      .where(eq(schema.workers.id, vstup.id));
    if (!povodny) {
      throw new Error("Pracovník neexistuje.");
    }

    const [upraveny] = await tx
      .update(schema.workers)
      .set({
        fullName,
        isActive: vstup.isActive ?? povodny.isActive,
      })
      .where(eq(schema.workers.id, vstup.id))
      .returning();

    await tx.insert(schema.auditLog).values({
      tableName: "workers",
      recordId: vstup.id,
      action: "update",
      changedBy: vstup.userId,
      changes: {
        old: { fullName: povodny.fullName },
        new: { fullName },
      },
    });

    return upraveny;
  });
}

/** Aktívni pracovníci zoradení podľa mena (pre výber v M4 formulároch). */
export function listWorkers(db: DbClient) {
  return db
    .select()
    .from(schema.workers)
    .where(
      and(isNull(schema.workers.deletedAt), eq(schema.workers.isActive, true)),
    )
    .orderBy(asc(schema.workers.fullName));
}

/** Guard: pracovník ako obsluha výrobnej dávky sa nemaže (dokladová história). */
export async function softDeleteWorker(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [davka] = await tx
      .select({ id: schema.productionBatches.id })
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.leadWorkerId, vstup.id))
      .limit(1);
    if (davka) {
      throw new Error(
        "Pracovníka nemožno zmazať — existujú k nemu výrobné dávky. Doklady sa nemažú.",
      );
    }

    await tx
      .update(schema.workers)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workers.id, vstup.id));

    await tx.insert(schema.auditLog).values({
      tableName: "workers",
      recordId: vstup.id,
      action: "delete",
      changedBy: vstup.userId,
      changes: null,
    });
  });
}

/** Pridá novú sadzbu do histórie (append-only — DB unique na worker+valid_from). */
export async function pridajSadzbu(
  db: DbClient,
  vstup: {
    userId: string;
    workerId: string;
    hourlyRateCents: number;
    /** "YYYY-MM-DD" */
    validFrom: string;
  },
): Promise<typeof schema.laborRates.$inferSelect> {
  try {
    const [sadzba] = await db
      .insert(schema.laborRates)
      .values({
        workerId: vstup.workerId,
        hourlyRateCents: vstup.hourlyRateCents,
        validFrom: vstup.validFrom,
        createdBy: vstup.userId,
      })
      .returning();
    return sadzba;
  } catch (e) {
    if (sqlState(e) === "23505") {
      throw new Error(
        `Pracovník už má sadzbu platnú od ${vstup.validFrom} — uprav dátum.`,
      );
    }
    throw e;
  }
}

/** Sadzba platná k dátumu: posledná so validFrom <= dátum (snapshot do batch_labor). */
export async function sadzbaKDatumu(
  db: DbClient,
  workerId: string,
  datum: string,
): Promise<typeof schema.laborRates.$inferSelect> {
  const [sadzba] = await db
    .select()
    .from(schema.laborRates)
    .where(
      and(
        eq(schema.laborRates.workerId, workerId),
        isNull(schema.laborRates.deletedAt),
        lte(schema.laborRates.validFrom, datum),
      ),
    )
    .orderBy(desc(schema.laborRates.validFrom))
    .limit(1);

  if (!sadzba) {
    throw new Error(`Pracovník nemá platnú sadzbu k dátumu ${datum}.`);
  }
  return sadzba;
}

/** História sadzieb pracovníka, najnovšia prvá. */
export function listSadzby(db: DbClient, workerId: string) {
  return db
    .select()
    .from(schema.laborRates)
    .where(
      and(
        eq(schema.laborRates.workerId, workerId),
        isNull(schema.laborRates.deletedAt),
      ),
    )
    .orderBy(desc(schema.laborRates.validFrom));
}
