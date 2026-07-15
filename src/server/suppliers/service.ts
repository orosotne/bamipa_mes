// Dodávatelia (M1). Vzor zo FIFO jadra: DI DbClient, slovenské doménové chyby,
// audit_log pri každej mutácii (SPEC §4).
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

export type SupplierPolia = {
  name: string;
  ico?: string | null;
  dic?: string | null;
  icDph?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
};

function validujNazov(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Názov dodávateľa nesmie byť prázdny.");
  }
  return trimmed;
}

export async function createSupplier(
  db: DbClient,
  vstup: { userId: string } & SupplierPolia,
): Promise<typeof schema.suppliers.$inferSelect> {
  const name = validujNazov(vstup.name);

  return db.transaction(async (tx) => {
    const [dodavatel] = await tx
      .insert(schema.suppliers)
      .values({
        name,
        ico: vstup.ico ?? null,
        dic: vstup.dic ?? null,
        icDph: vstup.icDph ?? null,
        address: vstup.address ?? null,
        email: vstup.email ?? null,
        phone: vstup.phone ?? null,
        note: vstup.note ?? null,
        createdBy: vstup.userId,
      })
      .returning();

    await tx.insert(schema.auditLog).values({
      tableName: "suppliers",
      recordId: dodavatel.id,
      action: "insert",
      changedBy: vstup.userId,
      changes: { new: { name } },
    });

    return dodavatel;
  });
}

export async function updateSupplier(
  db: DbClient,
  vstup: { userId: string; id: string } & SupplierPolia,
): Promise<typeof schema.suppliers.$inferSelect> {
  const name = validujNazov(vstup.name);

  return db.transaction(async (tx) => {
    const [povodny] = await tx
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, vstup.id));
    if (!povodny) {
      throw new Error("Dodávateľ neexistuje.");
    }

    const [upraveny] = await tx
      .update(schema.suppliers)
      .set({
        name,
        ico: vstup.ico ?? povodny.ico,
        dic: vstup.dic ?? povodny.dic,
        icDph: vstup.icDph ?? povodny.icDph,
        address: vstup.address ?? povodny.address,
        email: vstup.email ?? povodny.email,
        phone: vstup.phone ?? povodny.phone,
        note: vstup.note ?? povodny.note,
      })
      .where(eq(schema.suppliers.id, vstup.id))
      .returning();

    await tx.insert(schema.auditLog).values({
      tableName: "suppliers",
      recordId: vstup.id,
      action: "update",
      changedBy: vstup.userId,
      changes: { old: { name: povodny.name }, new: { name } },
    });

    return upraveny;
  });
}

/** Guard z návrhu: dodávateľa s faktúrami nemožno zmazať. */
export async function softDeleteSupplier(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [faktura] = await tx
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.supplierId, vstup.id))
      .limit(1);
    if (faktura) {
      throw new Error(
        "Dodávateľa nemožno zmazať — existujú k nemu faktúry. Doklady sa nemažú.",
      );
    }

    await tx
      .update(schema.suppliers)
      .set({ deletedAt: new Date() })
      .where(eq(schema.suppliers.id, vstup.id));

    await tx.insert(schema.auditLog).values({
      tableName: "suppliers",
      recordId: vstup.id,
      action: "delete",
      changedBy: vstup.userId,
      changes: null,
    });
  });
}

/** Aktívni dodávatelia zoradení podľa mena (výberové query — filtruje zmazaných). */
export function listSuppliers(db: DbClient) {
  return db
    .select()
    .from(schema.suppliers)
    .where(and(isNull(schema.suppliers.deletedAt)))
    .orderBy(asc(schema.suppliers.name));
}
