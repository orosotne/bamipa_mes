// Príjem na sklad (M2): príjemka + šarže + 'prijem' pohyby v JEDNEJ transakcii.
// Zostatky šarží nastavuje výhradne DB trigger (apply_stock_move) — služba
// loty zakladá so zostatkom 0 a píše prijem pohyby do knihy.
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

export type PolozkaPrijmu = {
  materialId: string;
  /** párovanie na konkrétny riadok faktúry (pri príjme z faktúry) */
  invoiceItemId?: string;
  /** šarža dodávateľa */
  supplierLotCode?: string;
  /** numeric(12,3) string, kladné */
  qty: string;
  /** numeric(14,4) string — dokladová cena šarže */
  unitPrice: string;
};

type SpolocneVstupy = {
  userId: string;
  receiptNumber: string;
  /** dátum príjmu ("YYYY-MM-DD") — 1. úroveň FIFO kľúča */
  receivedAt: string;
  polozky: PolozkaPrijmu[];
  note?: string;
};

export type VysledokPrijmu = {
  receipt: typeof schema.receipts.$inferSelect;
  loty: (typeof schema.materialLots.$inferSelect)[];
};

async function vytvorPrijem(
  db: DbClient,
  vstup: SpolocneVstupy & {
    source: "faktura" | "pociatocny_stav" | "ine";
    invoiceId: string | null;
  },
): Promise<VysledokPrijmu> {
  if (vstup.polozky.length === 0) {
    throw new Error("Príjemka musí mať aspoň jednu položku.");
  }

  return db.transaction(async (tx) => {
    const [receipt] = await tx
      .insert(schema.receipts)
      .values({
        receiptNumber: vstup.receiptNumber,
        source: vstup.source,
        invoiceId: vstup.invoiceId,
        receivedAt: vstup.receivedAt,
        note: vstup.note,
        createdBy: vstup.userId,
      })
      .returning();

    const loty: (typeof schema.materialLots.$inferSelect)[] = [];
    for (const [index, polozka] of vstup.polozky.entries()) {
      // Lot vzniká so zostatkom 0 (DB guard) — na stav ho dostane prijem pohyb.
      const [lot] = await tx
        .insert(schema.materialLots)
        .values({
          receiptId: receipt.id,
          lineNo: index + 1,
          invoiceItemId: polozka.invoiceItemId ?? null,
          materialId: polozka.materialId,
          supplierLotCode: polozka.supplierLotCode ?? null,
          qtyReceived: polozka.qty,
          unitPrice: polozka.unitPrice,
          createdBy: vstup.userId,
        })
        .returning();

      await tx.insert(schema.stockMoves).values({
        lotId: lot.id,
        moveType: "prijem",
        qtyDelta: polozka.qty,
        unitPrice: polozka.unitPrice,
        createdBy: vstup.userId,
      });

      loty.push(lot);
    }

    return { receipt, loty };
  });
}

/** Príjem viazaný na faktúru — jednotkové ceny položiek faktúry sa stávajú cenami šarží. */
export function prijemZoFaktury(
  db: DbClient,
  vstup: SpolocneVstupy & { invoiceId: string },
): Promise<VysledokPrijmu> {
  return vytvorPrijem(db, { ...vstup, source: "faktura" });
}

/** Počiatočný stav skladu pri nábehu systému — bez faktúry. */
export function pociatocnyStav(
  db: DbClient,
  vstup: SpolocneVstupy,
): Promise<VysledokPrijmu> {
  return vytvorPrijem(db, { ...vstup, source: "pociatocny_stav", invoiceId: null });
}
