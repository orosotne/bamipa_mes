// Zdieľaný krok záväzného transakčného FIFO protokolu (D1): kandidátne šarže
// materiálu vo FIFO poradí (receipts.received_at, receipts.receipt_number,
// material_lots.line_no), zamknuté FOR UPDATE OF material_lots proti súbehu.
// Používa výdaj navážky (issue.ts) aj inventúrna korekcia materiálu
// (corrections.ts) — poradie čerpania sa medzi nimi nesmie rozísť.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import type { FifoLot } from "./fifo";

/** Volať VNÚTRI transakcie — zámky FOR UPDATE platia len do jej konca. */
export async function nacitajFifoKandidatov(
  db: DbClient,
  materialId: string,
): Promise<FifoLot[]> {
  return db
    .select({
      id: schema.materialLots.id,
      receivedAt: schema.receipts.receivedAt,
      receiptNumber: schema.receipts.receiptNumber,
      lineNo: schema.materialLots.lineNo,
      qtyRemaining: schema.materialLots.qtyRemaining,
      unitPrice: schema.materialLots.unitPrice,
    })
    .from(schema.materialLots)
    .innerJoin(
      schema.receipts,
      eq(schema.materialLots.receiptId, schema.receipts.id),
    )
    .where(
      and(
        eq(schema.materialLots.materialId, materialId),
        isNull(schema.materialLots.deletedAt),
        gt(schema.materialLots.qtyRemaining, sql`0`),
      ),
    )
    .orderBy(
      schema.receipts.receivedAt,
      schema.receipts.receiptNumber,
      schema.materialLots.lineNo,
    )
    .for("update", { of: schema.materialLots });
}
