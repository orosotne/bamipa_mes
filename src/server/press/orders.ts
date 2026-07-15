// Výrobné príkazy lisovne (M6). Stavový automat vynucuje DB trigger
// work_orders_guard (0004): nova → vo_vyrobe | zrusena; vo_vyrobe → dokoncena;
// dokoncena → vo_vyrobe (reopen na opravy). DB hlášky sa propagujú surové.
import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { sqlState } from "@/server/action-utils";
import { dnesnyDatum } from "@/server/session";
import { generujCisloPrikazu } from "./numbering";

const MAX_POKUSY = 3;

export async function zalozPrikaz(
  db: DbClient,
  vstup: {
    userId: string;
    soleModelId: string;
    qtyPairsPlanned: number;
    prepBranch?: "barwell" | "sekanie" | null;
    note?: string;
  },
): Promise<typeof schema.workOrders.$inferSelect> {
  if (
    !Number.isInteger(vstup.qtyPairsPlanned) ||
    vstup.qtyPairsPlanned <= 0
  ) {
    throw new Error("Množstvo párov musí byť kladné celé číslo.");
  }

  const [artikel] = await db
    .select()
    .from(schema.soleModels)
    .where(
      and(
        eq(schema.soleModels.id, vstup.soleModelId),
        isNull(schema.soleModels.deletedAt),
      ),
    );
  if (!artikel) throw new Error("Artikel neexistuje.");
  if (!artikel.isActive) {
    throw new Error("Artikel je neaktívny — príkaz naň nemožno založiť.");
  }

  const rok = Number(dnesnyDatum().slice(0, 4));

  // Číslovanie max+1; race zachytí partial unique → nové číslo a nový pokus.
  let poslednaChyba: unknown;
  for (let pokus = 1; pokus <= MAX_POKUSY; pokus++) {
    try {
      const cislo = await generujCisloPrikazu(db, rok);
      return await db.transaction(async (tx) => {
        const [prikaz] = await tx
          .insert(schema.workOrders)
          .values({
            orderNumber: cislo,
            soleModelId: vstup.soleModelId,
            qtyPairsPlanned: vstup.qtyPairsPlanned,
            prepBranch: vstup.prepBranch ?? null,
            note: vstup.note ?? null,
            createdBy: vstup.userId,
          })
          .returning();

        await tx.insert(schema.auditLog).values({
          tableName: "work_orders",
          recordId: prikaz.id,
          action: "insert",
          changedBy: vstup.userId,
          changes: {
            new: { orderNumber: cislo, soleModelId: vstup.soleModelId },
          },
        });

        return prikaz;
      });
    } catch (e) {
      if (sqlState(e) !== "23505") throw e;
      poslednaChyba = e;
    }
  }
  throw poslednaChyba;
}

async function zmenStavPrikazu(
  db: DbClient,
  vstup: { userId: string; id: string },
  novyStav: "vo_vyrobe" | "dokoncena" | "zrusena",
): Promise<typeof schema.workOrders.$inferSelect> {
  return db.transaction(async (tx) => {
    const [povodny] = await tx
      .select()
      .from(schema.workOrders)
      .where(
        and(
          eq(schema.workOrders.id, vstup.id),
          isNull(schema.workOrders.deletedAt),
        ),
      );
    if (!povodny) throw new Error("Výrobný príkaz neexistuje.");

    // Prechod stráži DB trigger — neplatný vyhodí slovenskú hlášku.
    const [po] = await tx
      .update(schema.workOrders)
      .set({ status: novyStav })
      .where(eq(schema.workOrders.id, vstup.id))
      .returning();

    await tx.insert(schema.auditLog).values({
      tableName: "work_orders",
      recordId: vstup.id,
      action: "status_change",
      changedBy: vstup.userId,
      changes: { old: { status: povodny.status }, new: { status: novyStav } },
    });

    return po;
  });
}

/** vo_vyrobe → dokoncena (uzavretie príkazu majstrom). */
export async function dokonciPrikaz(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<typeof schema.workOrders.$inferSelect> {
  return zmenStavPrikazu(db, vstup, "dokoncena");
}

/** dokoncena → vo_vyrobe (znovuotvorenie na opravy). */
export async function otvorPrikaz(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<typeof schema.workOrders.$inferSelect> {
  return zmenStavPrikazu(db, vstup, "vo_vyrobe");
}

/** nova → zrusena (príkaz bez výroby). */
export async function zrusPrikaz(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<typeof schema.workOrders.$inferSelect> {
  return zmenStavPrikazu(db, vstup, "zrusena");
}
