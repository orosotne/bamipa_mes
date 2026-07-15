// Expedícia (M6): dodací list s položkami viazanými na výrobné príkazy.
// Invariant Σ expedované ≤ Σ vyrobené stráži DB trigger (0004) row-lockom
// na work_orders; služba zamyká príkazy v deterministickom poradí (podľa id)
// proti deadlocku a čísluje DL s retry na 23505 (vzor príjemky).
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { sqlState } from "@/server/action-utils";
import { dnesnyDatum } from "@/server/session";
import { generujCisloDodacieho } from "./numbering";

const MAX_POKUSY = 3;

export type VysledokDodacieho = {
  shipment: typeof schema.shipments.$inferSelect;
  items: (typeof schema.shipmentItems.$inferSelect)[];
};

export async function vytvorDodaciList(
  db: DbClient,
  vstup: {
    userId: string;
    /** "YYYY-MM-DD" */
    shipDate: string;
    customer: string;
    note?: string;
    polozky: { workOrderId: string; qtyPairs: number }[];
  },
): Promise<VysledokDodacieho> {
  const customer = vstup.customer.trim();
  if (!customer) throw new Error("Odberateľ nesmie byť prázdny.");
  if (vstup.polozky.length === 0) {
    throw new Error("Dodací list musí obsahovať aspoň jednu položku.");
  }
  const videnePrikazy = new Set<string>();
  for (const p of vstup.polozky) {
    if (videnePrikazy.has(p.workOrderId)) {
      throw new Error("Výrobný príkaz sa v položkách opakuje.");
    }
    videnePrikazy.add(p.workOrderId);
    if (!Number.isInteger(p.qtyPairs) || p.qtyPairs <= 0) {
      throw new Error("Počet expedovaných párov musí byť kladné celé číslo.");
    }
  }
  // Deterministické poradie zámkov (trigger zamyká work_orders per položka).
  const polozky = [...vstup.polozky].sort((a, b) =>
    a.workOrderId.localeCompare(b.workOrderId),
  );

  const rok = Number(dnesnyDatum().slice(0, 4));

  let poslednaChyba: unknown;
  for (let pokus = 1; pokus <= MAX_POKUSY; pokus++) {
    try {
      const cislo = await generujCisloDodacieho(db, rok);
      return await db.transaction(async (tx) => {
        const [shipment] = await tx
          .insert(schema.shipments)
          .values({
            shipmentNumber: cislo,
            shipDate: vstup.shipDate,
            customer,
            note: vstup.note ?? null,
            createdBy: vstup.userId,
          })
          .returning();

        const items: (typeof schema.shipmentItems.$inferSelect)[] = [];
        for (const p of polozky) {
          const [item] = await tx
            .insert(schema.shipmentItems)
            .values({
              shipmentId: shipment.id,
              workOrderId: p.workOrderId,
              qtyPairs: p.qtyPairs,
              createdBy: vstup.userId,
            })
            .returning();
          items.push(item);
        }

        await tx.insert(schema.auditLog).values({
          tableName: "shipments",
          recordId: shipment.id,
          action: "insert",
          changedBy: vstup.userId,
          changes: {
            new: {
              shipmentNumber: cislo,
              customer,
              polozky: polozky.map((p) => ({
                workOrderId: p.workOrderId,
                qtyPairs: p.qtyPairs,
              })),
            },
          },
        });

        return { shipment, items };
      });
    } catch (e) {
      if (sqlState(e) !== "23505") throw e;
      poslednaChyba = e;
    }
  }
  throw poslednaChyba;
}

/** Storno DL = soft delete hlavičky aj položiek v jednej transakcii. */
export async function stornoDodaciList(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [shipment] = await tx
      .select()
      .from(schema.shipments)
      .where(
        and(
          eq(schema.shipments.id, vstup.id),
          isNull(schema.shipments.deletedAt),
        ),
      );
    if (!shipment) {
      throw new Error("Dodací list neexistuje alebo už je stornovaný.");
    }

    // Zámky príkazov v deterministickom poradí (podľa id) PRED mazaním
    // položiek — jeden UPDATE by ich cez triggre zamykal v poradí skenu
    // riadkov a so súbežným vytvorDodaciList by mohol tvoriť deadlock.
    const zivePolozky = await tx
      .select({ workOrderId: schema.shipmentItems.workOrderId })
      .from(schema.shipmentItems)
      .where(
        and(
          eq(schema.shipmentItems.shipmentId, vstup.id),
          isNull(schema.shipmentItems.deletedAt),
        ),
      );
    const prikazIds = [...new Set(zivePolozky.map((p) => p.workOrderId))];
    if (prikazIds.length > 0) {
      await tx
        .select({ id: schema.workOrders.id })
        .from(schema.workOrders)
        .where(inArray(schema.workOrders.id, prikazIds))
        .orderBy(asc(schema.workOrders.id))
        .for("update");
    }

    const teraz = new Date();
    await tx
      .update(schema.shipmentItems)
      .set({ deletedAt: teraz })
      .where(
        and(
          eq(schema.shipmentItems.shipmentId, vstup.id),
          isNull(schema.shipmentItems.deletedAt),
        ),
      );
    await tx
      .update(schema.shipments)
      .set({ deletedAt: teraz })
      .where(eq(schema.shipments.id, vstup.id));

    await tx.insert(schema.auditLog).values({
      tableName: "shipments",
      recordId: vstup.id,
      action: "delete",
      changedBy: vstup.userId,
      changes: null,
    });
  });
}
