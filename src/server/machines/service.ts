// Stroje (M4 číselník). Vzor z M1/M2: DI DbClient, slovenské doménové chyby,
// audit_log pri každej mutácii, soft delete guard proti výrobným dávkam.
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { sqlState } from "@/server/action-utils";

export type MachinePolia = {
  code: string;
  name: string;
  costCenterId: string;
  isActive?: boolean;
};

function validuj(polia: MachinePolia): { code: string; name: string } {
  const code = polia.code.trim();
  const name = polia.name.trim();
  if (!code) throw new Error("Kód stroja nesmie byť prázdny.");
  if (!name) throw new Error("Názov stroja nesmie byť prázdny.");
  return { code, name };
}

export async function createMachine(
  db: DbClient,
  vstup: { userId: string } & MachinePolia,
): Promise<typeof schema.machines.$inferSelect> {
  const { code, name } = validuj(vstup);

  try {
    return await db.transaction(async (tx) => {
      const [stroj] = await tx
        .insert(schema.machines)
        .values({
          code,
          name,
          costCenterId: vstup.costCenterId,
          isActive: vstup.isActive ?? true,
          createdBy: vstup.userId,
        })
        .returning();

      await tx.insert(schema.auditLog).values({
        tableName: "machines",
        recordId: stroj.id,
        action: "insert",
        changedBy: vstup.userId,
        changes: { new: { code, name } },
      });

      return stroj;
    });
  } catch (e) {
    if (sqlState(e) === "23505") {
      throw new Error(`Stroj s kódom „${code}" už existuje.`);
    }
    throw e;
  }
}

export async function updateMachine(
  db: DbClient,
  vstup: { userId: string; id: string } & MachinePolia,
): Promise<typeof schema.machines.$inferSelect> {
  const { code, name } = validuj(vstup);

  try {
    return await db.transaction(async (tx) => {
      const [povodny] = await tx
        .select()
        .from(schema.machines)
        .where(eq(schema.machines.id, vstup.id));
      if (!povodny) {
        throw new Error("Stroj neexistuje.");
      }

      const [upraveny] = await tx
        .update(schema.machines)
        .set({
          code,
          name,
          costCenterId: vstup.costCenterId,
          isActive: vstup.isActive ?? povodny.isActive,
        })
        .where(eq(schema.machines.id, vstup.id))
        .returning();

      await tx.insert(schema.auditLog).values({
        tableName: "machines",
        recordId: vstup.id,
        action: "update",
        changedBy: vstup.userId,
        changes: {
          old: { code: povodny.code, name: povodny.name },
          new: { code, name },
        },
      });

      return upraveny;
    });
  } catch (e) {
    if (sqlState(e) === "23505") {
      throw new Error(`Stroj s kódom „${code}" už existuje.`);
    }
    throw e;
  }
}

/** Aktívne stroje zoradené podľa kódu (pre výber v M4 formulároch). */
export function listMachines(db: DbClient) {
  return db
    .select()
    .from(schema.machines)
    .where(
      and(isNull(schema.machines.deletedAt), eq(schema.machines.isActive, true)),
    )
    .orderBy(asc(schema.machines.code));
}

/** Guard: stroj s výrobnými dávkami sa nemaže (dokladová história). */
export async function softDeleteMachine(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [davka] = await tx
      .select({ id: schema.productionBatches.id })
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.machineId, vstup.id))
      .limit(1);
    if (davka) {
      throw new Error(
        "Stroj nemožno zmazať — existujú k nemu výrobné dávky. Doklady sa nemažú.",
      );
    }

    await tx
      .update(schema.machines)
      .set({ deletedAt: new Date() })
      .where(eq(schema.machines.id, vstup.id));

    await tx.insert(schema.auditLog).values({
      tableName: "machines",
      recordId: vstup.id,
      action: "delete",
      changedBy: vstup.userId,
      changes: null,
    });
  });
}
