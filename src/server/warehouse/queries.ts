// Čítacie queries skladu (M2). Konvencia dopytov zo schváleného návrhu:
// deleted_at filter na výberové queries; historické väzby (lot→faktúra)
// sa nefiltrujú. FIFO poradie: (received_at, receipt_number, line_no).
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { parseQty } from "@/server/inventory/money";

export type RiadokStavuSkladu = {
  id: string;
  code: string;
  name: string;
  unit: (typeof schema.materialUnit.enumValues)[number];
  category: (typeof schema.materialCategory.enumValues)[number];
  minStockQty: string | null;
  /** Σ qty_remaining živých šarží, numeric(14,3) string */
  zostatok: string;
  /** cena najnovšej šarže (FIFO kľúč DESC), null bez šarží */
  poslednaCena: string | null;
  podMinimom: boolean;
};

export async function stavSkladu(db: DbClient): Promise<RiadokStavuSkladu[]> {
  // POZOR: bez joinov renderuje Drizzle stĺpce nekvalifikovane — v korelovanom
  // subquery treba explicitné materials.id, inak sa "id" naviaže na alias l.
  const zostatokSql = sql<string>`coalesce((
    SELECT sum(l.qty_remaining) FROM material_lots l
    WHERE l.material_id = materials.id AND l.deleted_at IS NULL
  ), 0)::numeric(14,3)`;
  const poslednaCenaSql = sql<string | null>`(
    SELECT l.unit_price FROM material_lots l
    JOIN receipts r ON r.id = l.receipt_id
    WHERE l.material_id = materials.id AND l.deleted_at IS NULL
    ORDER BY r.received_at DESC, r.receipt_number DESC, l.line_no DESC
    LIMIT 1
  )`;

  const riadky = await db
    .select({
      id: schema.materials.id,
      code: schema.materials.code,
      name: schema.materials.name,
      unit: schema.materials.unit,
      category: schema.materials.category,
      minStockQty: schema.materials.minStockQty,
      zostatok: zostatokSql,
      poslednaCena: poslednaCenaSql,
    })
    .from(schema.materials)
    .where(isNull(schema.materials.deletedAt))
    .orderBy(asc(schema.materials.code));

  return riadky.map((r) => ({
    ...r,
    podMinimom:
      r.minStockQty !== null && parseQty(r.zostatok) < parseQty(r.minStockQty),
  }));
}

export type LotDetailu = {
  id: string;
  receiptNumber: string;
  receivedAt: string;
  supplierLotCode: string | null;
  qtyReceived: string;
  qtyRemaining: string;
  unitPrice: string;
  supplierName: string | null;
};

export async function detailMaterialu(
  db: DbClient,
  materialId: string,
): Promise<{
  material: typeof schema.materials.$inferSelect;
  loty: LotDetailu[];
}> {
  const [material] = await db
    .select()
    .from(schema.materials)
    .where(eq(schema.materials.id, materialId));
  if (!material) {
    throw new Error("Materiál neexistuje.");
  }

  const loty = await db
    .select({
      id: schema.materialLots.id,
      receiptNumber: schema.receipts.receiptNumber,
      receivedAt: schema.receipts.receivedAt,
      supplierLotCode: schema.materialLots.supplierLotCode,
      qtyReceived: schema.materialLots.qtyReceived,
      qtyRemaining: schema.materialLots.qtyRemaining,
      unitPrice: schema.materialLots.unitPrice,
      supplierName: schema.suppliers.name,
    })
    .from(schema.materialLots)
    .innerJoin(
      schema.receipts,
      eq(schema.materialLots.receiptId, schema.receipts.id),
    )
    .leftJoin(schema.invoices, eq(schema.receipts.invoiceId, schema.invoices.id))
    .leftJoin(schema.suppliers, eq(schema.invoices.supplierId, schema.suppliers.id))
    .where(
      and(
        eq(schema.materialLots.materialId, materialId),
        isNull(schema.materialLots.deletedAt),
      ),
    )
    .orderBy(
      asc(schema.receipts.receivedAt),
      asc(schema.receipts.receiptNumber),
      asc(schema.materialLots.lineNo),
    );

  return { material, loty };
}

export type BodCenovejHistorie = {
  lotId: string;
  receivedAt: string;
  unitPrice: string;
  supplierName: string | null;
  receiptNumber: string;
};

/** Vývoj nákupnej ceny per materiál (SPEC M2) — body chronologicky, s dodávateľom. */
export async function cenovaHistoria(
  db: DbClient,
  materialId: string,
): Promise<BodCenovejHistorie[]> {
  return db
    .select({
      lotId: schema.materialLots.id,
      receivedAt: schema.receipts.receivedAt,
      unitPrice: schema.materialLots.unitPrice,
      supplierName: schema.suppliers.name,
      receiptNumber: schema.receipts.receiptNumber,
    })
    .from(schema.materialLots)
    .innerJoin(
      schema.receipts,
      eq(schema.materialLots.receiptId, schema.receipts.id),
    )
    .leftJoin(schema.invoices, eq(schema.receipts.invoiceId, schema.invoices.id))
    .leftJoin(schema.suppliers, eq(schema.invoices.supplierId, schema.suppliers.id))
    .where(
      and(
        eq(schema.materialLots.materialId, materialId),
        isNull(schema.materialLots.deletedAt),
      ),
    )
    .orderBy(
      asc(schema.receipts.receivedAt),
      asc(schema.receipts.receiptNumber),
      asc(schema.materialLots.lineNo),
    );
}

export type RiadokZoznamuPrijemok = {
  id: string;
  receiptNumber: string;
  receivedAt: string;
  source: (typeof schema.receiptSource.enumValues)[number];
  invoiceId: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  pocetSarzi: number;
  /** Σ qty_received × unit_price, zaokrúhlené raz per príjemka */
  hodnotaCents: number;
};

export async function zoznamPrijemok(
  db: DbClient,
): Promise<RiadokZoznamuPrijemok[]> {
  const pocetSql = sql<number>`(
    SELECT count(*)::int FROM material_lots l
    WHERE l.receipt_id = ${schema.receipts.id} AND l.deleted_at IS NULL
  )`;
  const hodnotaSql = sql<string>`coalesce((
    SELECT round(sum(l.qty_received * l.unit_price)) FROM material_lots l
    WHERE l.receipt_id = ${schema.receipts.id} AND l.deleted_at IS NULL
  ), 0)`;

  const riadky = await db
    .select({
      id: schema.receipts.id,
      receiptNumber: schema.receipts.receiptNumber,
      receivedAt: schema.receipts.receivedAt,
      source: schema.receipts.source,
      invoiceId: schema.receipts.invoiceId,
      invoiceNumber: schema.invoices.invoiceNumber,
      supplierName: schema.suppliers.name,
      pocetSarzi: pocetSql,
      hodnota: hodnotaSql,
    })
    .from(schema.receipts)
    .leftJoin(schema.invoices, eq(schema.receipts.invoiceId, schema.invoices.id))
    .leftJoin(schema.suppliers, eq(schema.invoices.supplierId, schema.suppliers.id))
    .where(isNull(schema.receipts.deletedAt))
    .orderBy(desc(schema.receipts.receivedAt), desc(schema.receipts.receiptNumber));

  return riadky.map((r) => ({
    id: r.id,
    receiptNumber: r.receiptNumber,
    receivedAt: r.receivedAt,
    source: r.source,
    invoiceId: r.invoiceId,
    invoiceNumber: r.invoiceNumber,
    supplierName: r.supplierName,
    pocetSarzi: r.pocetSarzi,
    hodnotaCents: Number(r.hodnota),
  }));
}

export type FakturaNaParovanie = {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  /** už k nej existuje príjemka — varovanie pred duplicitným príjmom */
  maPrijemku: boolean;
  polozky: {
    id: string;
    description: string;
    qty: string | null;
    unit: string | null;
    unitPrice: string | null;
  }[];
};

/** Faktúry s materiálovými položkami — zdroj predvyplnenia novej príjemky. */
export async function fakturyNaParovanie(
  db: DbClient,
): Promise<FakturaNaParovanie[]> {
  const maPrijemkuSql = sql<boolean>`EXISTS (
    SELECT 1 FROM receipts r
    WHERE r.invoice_id = ${schema.invoices.id} AND r.deleted_at IS NULL
  )`;

  const polozky = await db
    .select({
      id: schema.invoiceItems.id,
      invoiceId: schema.invoiceItems.invoiceId,
      description: schema.invoiceItems.description,
      qty: schema.invoiceItems.qty,
      unit: schema.invoiceItems.unit,
      unitPrice: schema.invoiceItems.unitPrice,
      invoiceNumber: schema.invoices.invoiceNumber,
      supplierName: schema.suppliers.name,
      maPrijemku: maPrijemkuSql,
    })
    .from(schema.invoiceItems)
    .innerJoin(schema.invoices, eq(schema.invoiceItems.invoiceId, schema.invoices.id))
    .innerJoin(schema.suppliers, eq(schema.invoices.supplierId, schema.suppliers.id))
    .where(
      and(
        eq(schema.invoiceItems.category, "material"),
        isNull(schema.invoiceItems.deletedAt),
        isNull(schema.invoices.deletedAt),
      ),
    )
    .orderBy(asc(schema.invoices.invoiceNumber));

  const podlaFaktury = new Map<string, FakturaNaParovanie>();
  for (const p of polozky) {
    let faktura = podlaFaktury.get(p.invoiceId);
    if (!faktura) {
      faktura = {
        id: p.invoiceId,
        invoiceNumber: p.invoiceNumber,
        supplierName: p.supplierName,
        maPrijemku: p.maPrijemku,
        polozky: [],
      };
      podlaFaktury.set(p.invoiceId, faktura);
    }
    faktura.polozky.push({
      id: p.id,
      description: p.description,
      qty: p.qty,
      unit: p.unit,
      unitPrice: p.unitPrice,
    });
  }
  return [...podlaFaktury.values()];
}
