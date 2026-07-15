// Príjem na sklad (M2): príjemka + šarže + 'prijem' pohyby v jednej transakcii.
// Integračné testy nad PGlite — overujú aj DB triggre (qty_remaining) a CHECK-y.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedFaktura, seedZaklad, type TestDb } from "@/test/pglite";
import { pociatocnyStav, prijemZoFaktury } from "./receipts";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db);
});

describe("prijemZoFaktury", () => {
  test("vytvorí príjemku, šarže s line_no a prijem pohyby; zostatky nastaví DB trigger", async () => {
    const { faktura, polozka } = await seedFaktura(db, zaklad);

    const vysledok = await prijemZoFaktury(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-2026-001",
      receivedAt: "2026-07-10",
      invoiceId: faktura.id,
      polozky: [
        {
          materialId: zaklad.material.id,
          invoiceItemId: polozka.id,
          supplierLotCode: "LOT-A1",
          qty: "1500.000",
          unitPrice: "45.3500",
        },
        {
          materialId: zaklad.material.id,
          invoiceItemId: polozka.id,
          qty: "1000.000",
          unitPrice: "45.3500",
        },
      ],
    });

    // Príjemka viazaná na faktúru.
    expect(vysledok.receipt.source).toBe("faktura");
    expect(vysledok.receipt.invoiceId).toBe(faktura.id);

    // Šarže: line_no 1 a 2, zostatok = prijaté (nastavil trigger, nie my).
    const loty = await db
      .select()
      .from(schema.materialLots)
      .where(eq(schema.materialLots.receiptId, vysledok.receipt.id))
      .orderBy(schema.materialLots.lineNo);
    expect(loty).toHaveLength(2);
    expect(loty[0].lineNo).toBe(1);
    expect(loty[1].lineNo).toBe(2);
    expect(loty[0].qtyRemaining).toBe("1500.000");
    expect(loty[1].qtyRemaining).toBe("1000.000");
    expect(loty[0].supplierLotCode).toBe("LOT-A1");
    expect(loty[0].invoiceItemId).toBe(polozka.id);

    // Kniha pohybov: prijem riadok per šarža, bez batch_id.
    const pohyby = await db
      .select()
      .from(schema.stockMoves)
      .where(eq(schema.stockMoves.lotId, loty[0].id));
    expect(pohyby).toHaveLength(1);
    expect(pohyby[0].moveType).toBe("prijem");
    expect(pohyby[0].qtyDelta).toBe("1500.000");
    expect(pohyby[0].unitPrice).toBe("45.3500");
    expect(pohyby[0].batchId).toBeNull();
  });

  test("chybná položka → rollback celej príjemky (žiadna hlavička ani šarže)", async () => {
    const { faktura } = await seedFaktura(db, zaklad);

    await expect(
      prijemZoFaktury(db, {
        userId: zaklad.adminId,
        receiptNumber: "P-2026-002",
        receivedAt: "2026-07-10",
        invoiceId: faktura.id,
        polozky: [
          { materialId: zaklad.material.id, qty: "100.000", unitPrice: "45.3500" },
          // qty <= 0 poruší DB CHECK material_lots_qty_received_positive
          { materialId: zaklad.material.id, qty: "0.000", unitPrice: "45.3500" },
        ],
      }),
    ).rejects.toThrow();

    const receipts = await db.select().from(schema.receipts);
    expect(receipts).toHaveLength(0);
    const loty = await db.select().from(schema.materialLots);
    expect(loty).toHaveLength(0);
  });
});

describe("pociatocnyStav", () => {
  test("príjem bez faktúry so source='pociatocny_stav' (nábeh systému)", async () => {
    const vysledok = await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-INIT-001",
      receivedAt: "2026-07-01",
      polozky: [
        { materialId: zaklad.material.id, qty: "800.000", unitPrice: "42.0000" },
      ],
    });

    expect(vysledok.receipt.source).toBe("pociatocny_stav");
    expect(vysledok.receipt.invoiceId).toBeNull();

    const loty = await db
      .select()
      .from(schema.materialLots)
      .where(eq(schema.materialLots.receiptId, vysledok.receipt.id));
    expect(loty).toHaveLength(1);
    expect(loty[0].qtyRemaining).toBe("800.000");
  });
});
