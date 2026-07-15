// Došlé faktúry (M1): vytvorenie s položkami, stavový automat
// (nová → schválená → čiastočne/úplne zaplatená), platby, cash-flow filtre.
// „Dnes" sa VŽDY odovzdáva parametrom — logika je deterministicky testovateľná.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  createInvoice,
  pridatPlatbu,
  schvalitFakturu,
  zoznamFaktur,
} from "./service";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db);
});

/** Faktúra 100 € net + 20 € DPH = 120 € gross s dvomi položkami (60+40). */
function vstupFaktury(overrides: Partial<Parameters<typeof createInvoice>[1]> = {}) {
  return {
    userId: zaklad.adminId,
    supplierId: zaklad.dodavatel.id,
    invoiceNumber: "FA-2026-100",
    dueDate: "2026-08-15",
    totalNetCents: 10_000,
    totalVatCents: 2_000,
    totalGrossCents: 12_000,
    polozky: [
      {
        description: "Sadze N330",
        category: "material" as const,
        costCenterId: zaklad.stredisko.id,
        totalNetCents: 6_000,
      },
      {
        description: "Doprava",
        category: "sluzby" as const,
        costCenterId: zaklad.stredisko.id,
        totalNetCents: 4_000,
      },
    ],
    ...overrides,
  };
}

describe("createInvoice", () => {
  test("vytvorí hlavičku + položky v stave 'nova' a zapíše audit", async () => {
    const { invoice, items } = await createInvoice(db, vstupFaktury());

    expect(invoice.status).toBe("nova");
    expect(invoice.totalGrossCents).toBe(12_000);
    expect(items).toHaveLength(2);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.tableName, "invoices"),
          eq(schema.auditLog.recordId, invoice.id),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("insert");
  });

  test("Σ položiek ≠ hlavička net → slovenská chyba a rollback", async () => {
    await expect(
      createInvoice(
        db,
        vstupFaktury({
          polozky: [
            {
              description: "Sadze",
              category: "material",
              costCenterId: zaklad.stredisko.id,
              totalNetCents: 9_999, // nesedí na 10 000
            },
          ],
        }),
      ),
    ).rejects.toThrow(/položiek/);

    expect(await db.select().from(schema.invoices)).toHaveLength(0);
  });

  test("bez položiek → chyba", async () => {
    await expect(
      createInvoice(db, vstupFaktury({ polozky: [] })),
    ).rejects.toThrow(/položk/);
  });

  test("duplicitné číslo u toho istého dodávateľa → slovenská chyba", async () => {
    await createInvoice(db, vstupFaktury());
    await expect(createInvoice(db, vstupFaktury())).rejects.toThrow(/číslom/);
  });

  test("rovnaké číslo u iného dodávateľa je OK", async () => {
    await createInvoice(db, vstupFaktury());
    const [iny] = await db
      .insert(schema.suppliers)
      .values({ name: "Iný dodávateľ", createdBy: zaklad.adminId })
      .returning();

    const { invoice } = await createInvoice(
      db,
      vstupFaktury({ supplierId: iny.id }),
    );
    expect(invoice.invoiceNumber).toBe("FA-2026-100");
  });

  test("gross ≠ net + DPH → slovenská chyba (DB CHECK preložený)", async () => {
    await expect(
      createInvoice(db, vstupFaktury({ totalGrossCents: 11_999 })),
    ).rejects.toThrow(/DPH/);
  });
});

describe("schvalitFakturu", () => {
  test("nová → schválená + audit status_change", async () => {
    const { invoice } = await createInvoice(db, vstupFaktury());

    const schvalena = await schvalitFakturu(db, {
      userId: zaklad.adminId,
      id: invoice.id,
    });

    expect(schvalena.status).toBe("schvalena");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.recordId, invoice.id),
          eq(schema.auditLog.action, "status_change"),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  test("už schválenú nemožno schváliť znova", async () => {
    const { invoice } = await createInvoice(db, vstupFaktury());
    await schvalitFakturu(db, { userId: zaklad.adminId, id: invoice.id });

    await expect(
      schvalitFakturu(db, { userId: zaklad.adminId, id: invoice.id }),
    ).rejects.toThrow(/schválen/);
  });
});

describe("pridatPlatbu (stavový automat platieb)", () => {
  test("na neschválenú faktúru → chyba „najprv schváľte“", async () => {
    const { invoice } = await createInvoice(db, vstupFaktury());

    await expect(
      pridatPlatbu(db, {
        userId: zaklad.adminId,
        invoiceId: invoice.id,
        paidAt: "2026-07-20",
        amountCents: 5_000,
      }),
    ).rejects.toThrow(/schváľte/);
  });

  test("čiastočná platba → 'ciastocne_zaplatena'", async () => {
    const { invoice } = await createInvoice(db, vstupFaktury());
    await schvalitFakturu(db, { userId: zaklad.adminId, id: invoice.id });

    const { invoice: poPlatbe } = await pridatPlatbu(db, {
      userId: zaklad.adminId,
      invoiceId: invoice.id,
      paidAt: "2026-07-20",
      amountCents: 5_000,
    });

    expect(poPlatbe.status).toBe("ciastocne_zaplatena");
  });

  test("dorovnanie na gross → 'zaplatena'", async () => {
    const { invoice } = await createInvoice(db, vstupFaktury());
    await schvalitFakturu(db, { userId: zaklad.adminId, id: invoice.id });
    await pridatPlatbu(db, {
      userId: zaklad.adminId,
      invoiceId: invoice.id,
      paidAt: "2026-07-20",
      amountCents: 5_000,
    });

    const { invoice: poDoplatku } = await pridatPlatbu(db, {
      userId: zaklad.adminId,
      invoiceId: invoice.id,
      paidAt: "2026-07-25",
      amountCents: 7_000,
    });

    expect(poDoplatku.status).toBe("zaplatena");
  });

  test("preplatok → tiež 'zaplatena'", async () => {
    const { invoice } = await createInvoice(db, vstupFaktury());
    await schvalitFakturu(db, { userId: zaklad.adminId, id: invoice.id });

    const { invoice: poPlatbe } = await pridatPlatbu(db, {
      userId: zaklad.adminId,
      invoiceId: invoice.id,
      paidAt: "2026-07-20",
      amountCents: 12_500,
    });

    expect(poPlatbe.status).toBe("zaplatena");
  });
});

describe("zoznamFaktur (cash-flow filtre — SPEC M1 + akceptačné kritérium)", () => {
  /** 3 faktúry: po splatnosti (nezaplatená), splatná o 5 dní, splatná o 20 dní. */
  async function triFaktury() {
    const poSplatnosti = await createInvoice(
      db,
      vstupFaktury({ invoiceNumber: "FA-OLD", dueDate: "2026-07-01" }),
    );
    await schvalitFakturu(db, { userId: zaklad.adminId, id: poSplatnosti.invoice.id });

    await createInvoice(
      db,
      vstupFaktury({ invoiceNumber: "FA-SOON", dueDate: "2026-07-18" }),
    );
    await createInvoice(
      db,
      vstupFaktury({ invoiceNumber: "FA-LATER", dueDate: "2026-08-02" }),
    );
    return poSplatnosti;
  }

  test("po_splatnosti: len nezaplatené so splatnosťou v minulosti + zostatok", async () => {
    await triFaktury();

    const zoznam = await zoznamFaktur(db, {
      dnes: "2026-07-13",
      filter: { typ: "po_splatnosti" },
    });

    expect(zoznam).toHaveLength(1);
    expect(zoznam[0].invoiceNumber).toBe("FA-OLD");
    expect(zoznam[0].zostatokCents).toBe(12_000);
    expect(zoznam[0].supplierName).toBe("Test dodávateľ s.r.o.");
  });

  test("úplne zaplatená po splatnosti sa v po_splatnosti NEukazuje", async () => {
    const poSplatnosti = await triFaktury();
    await pridatPlatbu(db, {
      userId: zaklad.adminId,
      invoiceId: poSplatnosti.invoice.id,
      paidAt: "2026-07-12",
      amountCents: 12_000,
    });

    const zoznam = await zoznamFaktur(db, {
      dnes: "2026-07-13",
      filter: { typ: "po_splatnosti" },
    });
    expect(zoznam).toHaveLength(0);
  });

  test("splatné do 7 dní: zahŕňa FA-SOON, nie FA-LATER ani po splatnosti", async () => {
    await triFaktury();

    const zoznam = await zoznamFaktur(db, {
      dnes: "2026-07-13",
      filter: { typ: "splatne_do", dni: 7 },
    });

    expect(zoznam.map((f) => f.invoiceNumber)).toEqual(["FA-SOON"]);
  });

  test("splatné do 30 dní zahŕňa FA-SOON aj FA-LATER (zoradené podľa splatnosti)", async () => {
    await triFaktury();

    const zoznam = await zoznamFaktur(db, {
      dnes: "2026-07-13",
      filter: { typ: "splatne_do", dni: 30 },
    });

    expect(zoznam.map((f) => f.invoiceNumber)).toEqual(["FA-SOON", "FA-LATER"]);
  });

  test("vsetky: čiastočná platba znižuje zostatok", async () => {
    const { invoice } = await createInvoice(db, vstupFaktury());
    await schvalitFakturu(db, { userId: zaklad.adminId, id: invoice.id });
    await pridatPlatbu(db, {
      userId: zaklad.adminId,
      invoiceId: invoice.id,
      paidAt: "2026-07-12",
      amountCents: 4_500,
    });

    const zoznam = await zoznamFaktur(db, { dnes: "2026-07-13" });

    expect(zoznam).toHaveLength(1);
    expect(zoznam[0].zostatokCents).toBe(7_500);
    expect(zoznam[0].status).toBe("ciastocne_zaplatena");
  });
});
