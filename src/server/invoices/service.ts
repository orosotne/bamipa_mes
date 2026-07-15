// Došlé faktúry (M1). Stavový automat: nova → schvalena → (ciastocne_)zaplatena.
// Vzor zo FIFO jadra: DI DbClient, slovenské doménové chyby, audit_log (SPEC §4).
// „Dnes" sa všade odovzdáva parametrom — žiadne Date.now v logike.
import { and, asc, eq, gt, gte, isNull, lt, lte, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { sqlState } from "@/server/action-utils";

export type PolozkaFaktury = {
  description: string;
  category: (typeof schema.invoiceCategory.enumValues)[number];
  costCenterId: string;
  qty?: string | null;
  unit?: string | null;
  unitPrice?: string | null;
  totalNetCents: number;
};

export type VstupFaktury = {
  userId: string;
  supplierId: string;
  invoiceNumber: string;
  issueDate?: string | null;
  deliveryDate?: string | null;
  dueDate: string;
  totalNetCents: number;
  totalVatCents: number;
  totalGrossCents: number;
  note?: string | null;
  polozky: PolozkaFaktury[];
};

export async function createInvoice(
  db: DbClient,
  vstup: VstupFaktury,
): Promise<{
  invoice: typeof schema.invoices.$inferSelect;
  items: (typeof schema.invoiceItems.$inferSelect)[];
}> {
  if (vstup.polozky.length === 0) {
    throw new Error("Faktúra musí mať aspoň jednu položku.");
  }

  const sumaPoloziek = vstup.polozky.reduce((s, p) => s + p.totalNetCents, 0);
  if (sumaPoloziek !== vstup.totalNetCents) {
    throw new Error(
      `Súčet položiek (${sumaPoloziek} c) nesedí so sumou faktúry bez DPH (${vstup.totalNetCents} c).`,
    );
  }

  try {
    return await db.transaction(async (tx) => {
      const [invoice] = await tx
        .insert(schema.invoices)
        .values({
          supplierId: vstup.supplierId,
          invoiceNumber: vstup.invoiceNumber.trim(),
          issueDate: vstup.issueDate ?? null,
          deliveryDate: vstup.deliveryDate ?? null,
          dueDate: vstup.dueDate,
          totalNetCents: vstup.totalNetCents,
          totalVatCents: vstup.totalVatCents,
          totalGrossCents: vstup.totalGrossCents,
          note: vstup.note ?? null,
          createdBy: vstup.userId,
        })
        .returning();

      const items: (typeof schema.invoiceItems.$inferSelect)[] = [];
      for (const polozka of vstup.polozky) {
        const [item] = await tx
          .insert(schema.invoiceItems)
          .values({
            invoiceId: invoice.id,
            description: polozka.description,
            category: polozka.category,
            costCenterId: polozka.costCenterId,
            qty: polozka.qty ?? null,
            unit: polozka.unit ?? null,
            unitPrice: polozka.unitPrice ?? null,
            totalNetCents: polozka.totalNetCents,
            createdBy: vstup.userId,
          })
          .returning();
        items.push(item);
      }

      await tx.insert(schema.auditLog).values({
        tableName: "invoices",
        recordId: invoice.id,
        action: "insert",
        changedBy: vstup.userId,
        changes: { new: { invoiceNumber: invoice.invoiceNumber } },
      });

      return { invoice, items };
    });
  } catch (e) {
    if (sqlState(e) === "23505") {
      throw new Error(
        `Faktúra s číslom „${vstup.invoiceNumber}" od tohto dodávateľa už existuje.`,
      );
    }
    if (sqlState(e) === "23514") {
      throw new Error(
        "Suma s DPH nesedí: musí platiť suma bez DPH + DPH = suma s DPH.",
      );
    }
    throw e;
  }
}

export async function schvalitFakturu(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<typeof schema.invoices.$inferSelect> {
  return db.transaction(async (tx) => {
    const [faktura] = await tx
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, vstup.id));
    if (!faktura) {
      throw new Error("Faktúra neexistuje.");
    }
    if (faktura.status !== "nova") {
      throw new Error("Faktúra už bola schválená.");
    }

    const [schvalena] = await tx
      .update(schema.invoices)
      .set({ status: "schvalena" })
      .where(eq(schema.invoices.id, vstup.id))
      .returning();

    await tx.insert(schema.auditLog).values({
      tableName: "invoices",
      recordId: vstup.id,
      action: "status_change",
      changedBy: vstup.userId,
      changes: { old: { status: "nova" }, new: { status: "schvalena" } },
    });

    return schvalena;
  });
}

export async function pridatPlatbu(
  db: DbClient,
  vstup: {
    userId: string;
    invoiceId: string;
    paidAt: string;
    amountCents: number;
    note?: string | null;
  },
): Promise<{
  payment: typeof schema.invoicePayments.$inferSelect;
  invoice: typeof schema.invoices.$inferSelect;
}> {
  return db.transaction(async (tx) => {
    const [faktura] = await tx
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, vstup.invoiceId));
    if (!faktura) {
      throw new Error("Faktúra neexistuje.");
    }
    if (faktura.status === "nova") {
      throw new Error("Faktúru najprv schváľte — platby sa evidujú na schválené doklady.");
    }

    const [payment] = await tx
      .insert(schema.invoicePayments)
      .values({
        invoiceId: vstup.invoiceId,
        paidAt: vstup.paidAt,
        amountCents: vstup.amountCents,
        note: vstup.note ?? null,
        createdBy: vstup.userId,
      })
      .returning();

    // Prepočet stavu zo VŠETKÝCH platieb (nie inkrementálne — idempotentné).
    const [{ zaplatene }] = await tx
      .select({
        zaplatene: sql<number>`coalesce(sum(${schema.invoicePayments.amountCents}), 0)::bigint`,
      })
      .from(schema.invoicePayments)
      .where(
        and(
          eq(schema.invoicePayments.invoiceId, vstup.invoiceId),
          isNull(schema.invoicePayments.deletedAt),
        ),
      );

    const novyStav =
      Number(zaplatene) >= faktura.totalGrossCents
        ? ("zaplatena" as const)
        : Number(zaplatene) > 0
          ? ("ciastocne_zaplatena" as const)
          : ("schvalena" as const);

    const [invoice] = await tx
      .update(schema.invoices)
      .set({ status: novyStav })
      .where(eq(schema.invoices.id, vstup.invoiceId))
      .returning();

    await tx.insert(schema.auditLog).values({
      tableName: "invoices",
      recordId: vstup.invoiceId,
      action: "payment",
      changedBy: vstup.userId,
      changes: {
        amountCents: vstup.amountCents,
        paidAt: vstup.paidAt,
        newStatus: novyStav,
      },
    });

    return { payment, invoice };
  });
}

export type FilterFaktur =
  | { typ: "vsetky" }
  | { typ: "po_splatnosti" }
  | { typ: "splatne_do"; dni: 7 | 14 | 30 };

export type RiadokZoznamuFaktur = {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  dueDate: string;
  totalGrossCents: number;
  zostatokCents: number;
  status: (typeof schema.invoiceStatus.enumValues)[number];
};

/**
 * Zoznam faktúr pre cash-flow (SPEC M1): zostatok = gross − Σ platieb.
 * po_splatnosti: splatnosť < dnes A zostatok > 0.
 * splatne_do: dnes ≤ splatnosť ≤ dnes + N dní A zostatok > 0.
 */
export async function zoznamFaktur(
  db: DbClient,
  vstup: { dnes: string; filter?: FilterFaktur },
): Promise<RiadokZoznamuFaktur[]> {
  const filter = vstup.filter ?? { typ: "vsetky" };

  const zaplateneSql = sql<number>`coalesce((
    SELECT sum(p.amount_cents) FROM invoice_payments p
    WHERE p.invoice_id = ${schema.invoices.id} AND p.deleted_at IS NULL
  ), 0)`;
  const zostatokSql = sql<number>`${schema.invoices.totalGrossCents} - ${zaplateneSql}`;

  const podmienky = [isNull(schema.invoices.deletedAt)];
  if (filter.typ === "po_splatnosti") {
    podmienky.push(lt(schema.invoices.dueDate, vstup.dnes));
    podmienky.push(gt(zostatokSql, 0));
  } else if (filter.typ === "splatne_do") {
    const hranica = sql<string>`(${vstup.dnes}::date + ${filter.dni}::int)`;
    podmienky.push(gte(schema.invoices.dueDate, vstup.dnes));
    podmienky.push(lte(sql`${schema.invoices.dueDate}::date`, hranica));
    podmienky.push(gt(zostatokSql, 0));
  }

  const riadky = await db
    .select({
      id: schema.invoices.id,
      invoiceNumber: schema.invoices.invoiceNumber,
      supplierName: schema.suppliers.name,
      dueDate: schema.invoices.dueDate,
      totalGrossCents: schema.invoices.totalGrossCents,
      zostatok: zostatokSql,
      status: schema.invoices.status,
    })
    .from(schema.invoices)
    .innerJoin(
      schema.suppliers,
      eq(schema.invoices.supplierId, schema.suppliers.id),
    )
    .where(and(...podmienky))
    .orderBy(asc(schema.invoices.dueDate), asc(schema.invoices.invoiceNumber));

  return riadky.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    supplierName: r.supplierName,
    dueDate: r.dueDate,
    totalGrossCents: r.totalGrossCents,
    zostatokCents: Number(r.zostatok),
    status: r.status,
  }));
}
