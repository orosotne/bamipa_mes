// Čítacie queries skladu (M2): stav, detail so šaržami, cenová história,
// zoznam príjemok, faktúry na párovanie.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { inventurnaKorekcia } from "@/server/inventory/corrections";
import { pociatocnyStav, prijemZoFaktury } from "@/server/inventory/receipts";
import { createMaterial } from "@/server/materials/service";
import {
  createTestDb,
  seedFaktura,
  seedZaklad,
  type TestDb,
} from "@/test/pglite";
import {
  cenovaHistoria,
  detailMaterialu,
  fakturyNaParovanie,
  stavSkladu,
  zoznamPrijemok,
} from "./queries";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db);
});

/** Dva príjmy toho istého materiálu v rôznych dňoch s rôznymi cenami. */
async function dvaPrijmy() {
  const p1 = await pociatocnyStav(db, {
    userId: zaklad.adminId,
    receiptNumber: "P-2026-0001",
    receivedAt: "2026-07-01",
    polozky: [
      { materialId: zaklad.material.id, qty: "200.000", unitPrice: "40.0000" },
    ],
  });
  const { faktura } = await seedFaktura(db, zaklad, {
    cislo: "FA-CH-1",
    qty: "300.000",
    unitPrice: "45.0000",
  });
  const p2 = await prijemZoFaktury(db, {
    userId: zaklad.adminId,
    receiptNumber: "P-2026-0002",
    receivedAt: "2026-07-05",
    invoiceId: faktura.id,
    polozky: [
      { materialId: zaklad.material.id, qty: "300.000", unitPrice: "45.0000" },
    ],
  });
  return { p1, p2 };
}

describe("stavSkladu", () => {
  test("Σ zostatkov, posledná cena (najnovší lot) a podMinimom flag", async () => {
    await dvaPrijmy(); // spolu 500 kg
    await db
      .update(schema.materials)
      .set({ minStockQty: "600.000" }) // viac než 500 → pod minimom
      .where(eq(schema.materials.id, zaklad.material.id));

    const bezZasob = await createMaterial(db, {
      userId: zaklad.adminId,
      code: "BEZ-ZASOB",
      name: "Materiál bez zásob",
      unit: "kg",
      category: "ine",
    });

    const stav = await stavSkladu(db);

    const sadze = stav.find((r) => r.code === "SADZE-N330")!;
    expect(sadze.zostatok).toBe("500.000");
    expect(sadze.poslednaCena).toBe("45.0000");
    expect(sadze.podMinimom).toBe(true);

    const prazdny = stav.find((r) => r.id === bezZasob.id)!;
    expect(prazdny.zostatok).toBe("0.000");
    expect(prazdny.poslednaCena).toBeNull();
    expect(prazdny.podMinimom).toBe(false); // bez min. zásoby sa neflaguje
  });

  test("inventúrne manko znižuje zostatok", async () => {
    const { p1 } = await dvaPrijmy();
    await inventurnaKorekcia(db, {
      userId: zaklad.adminId,
      lotId: p1.loty[0].id,
      qtyDelta: "-50.000",
      costCenterId: zaklad.stredisko.id,
    });

    const stav = await stavSkladu(db);
    expect(stav.find((r) => r.code === "SADZE-N330")!.zostatok).toBe("450.000");
  });
});

describe("detailMaterialu", () => {
  test("šarže vo FIFO poradí s dodávateľom z faktúry", async () => {
    await dvaPrijmy();

    const detail = await detailMaterialu(db, zaklad.material.id);

    expect(detail.material.code).toBe("SADZE-N330");
    expect(detail.loty).toHaveLength(2);
    // FIFO: starší príjem prvý
    expect(detail.loty[0].receiptNumber).toBe("P-2026-0001");
    expect(detail.loty[0].supplierName).toBeNull(); // počiatočný stav bez faktúry
    expect(detail.loty[1].receiptNumber).toBe("P-2026-0002");
    expect(detail.loty[1].supplierName).toBe("Test dodávateľ s.r.o.");
    expect(detail.loty[1].unitPrice).toBe("45.0000");
  });

  test("neexistujúci materiál → chyba", async () => {
    await expect(
      detailMaterialu(db, "00000000-0000-0000-0000-00000000dead"),
    ).rejects.toThrow();
  });
});

describe("cenovaHistoria", () => {
  test("chronologické body s cenou a dodávateľom", async () => {
    await dvaPrijmy();

    const body = await cenovaHistoria(db, zaklad.material.id);

    expect(body).toEqual([
      expect.objectContaining({
        receivedAt: "2026-07-01",
        unitPrice: "40.0000",
        supplierName: null,
      }),
      expect.objectContaining({
        receivedAt: "2026-07-05",
        unitPrice: "45.0000",
        supplierName: "Test dodávateľ s.r.o.",
      }),
    ]);
  });
});

describe("zoznamPrijemok", () => {
  test("najnovšie prvé, s dodávateľom, počtom šarží a hodnotou", async () => {
    await dvaPrijmy();

    const zoznam = await zoznamPrijemok(db);

    expect(zoznam).toHaveLength(2);
    expect(zoznam[0].receiptNumber).toBe("P-2026-0002"); // najnovšia prvá
    expect(zoznam[0].source).toBe("faktura");
    expect(zoznam[0].supplierName).toBe("Test dodávateľ s.r.o.");
    expect(zoznam[0].invoiceNumber).toBe("FA-CH-1");
    expect(zoznam[0].pocetSarzi).toBe(1);
    expect(zoznam[0].hodnotaCents).toBe(13_500); // 300 × 45,0000
    expect(zoznam[1].source).toBe("pociatocny_stav");
    expect(zoznam[1].supplierName).toBeNull();
    expect(zoznam[1].hodnotaCents).toBe(8_000); // 200 × 40,0000
  });
});

describe("fakturyNaParovanie", () => {
  test("vráti faktúry s materiálovými položkami (na predvyplnenie príjemky)", async () => {
    const { faktura, polozka } = await seedFaktura(db, zaklad, {
      cislo: "FA-MAT-1",
      qty: "1000.000",
      unitPrice: "42.5000",
    });
    // faktúra len so službami sa nemá ponúkať
    const [sluzbovaFa] = await db
      .insert(schema.invoices)
      .values({
        supplierId: zaklad.dodavatel.id,
        invoiceNumber: "FA-SLUZBY",
        dueDate: "2026-08-01",
        totalNetCents: 5_000,
        totalVatCents: 1_000,
        totalGrossCents: 6_000,
        createdBy: zaklad.adminId,
      })
      .returning();
    await db.insert(schema.invoiceItems).values({
      invoiceId: sluzbovaFa.id,
      description: "Doprava",
      category: "sluzby",
      costCenterId: zaklad.stredisko.id,
      totalNetCents: 5_000,
      createdBy: zaklad.adminId,
    });

    const zoznam = await fakturyNaParovanie(db);

    expect(zoznam).toHaveLength(1);
    expect(zoznam[0].invoiceNumber).toBe("FA-MAT-1");
    expect(zoznam[0].supplierName).toBe("Test dodávateľ s.r.o.");
    expect(zoznam[0].polozky).toHaveLength(1);
    expect(zoznam[0].polozky[0].id).toBe(polozka.id);
    expect(zoznam[0].polozky[0].unitPrice).toBe("42.5000");
    expect(faktura.id).toBe(zoznam[0].id);
    expect(zoznam[0].maPrijemku).toBe(false);
  });

  test("faktúra s existujúcou príjemkou má maPrijemku=true (varovanie pred duplicitným príjmom)", async () => {
    const { faktura } = await seedFaktura(db, zaklad, {
      cislo: "FA-PRIJATA",
      qty: "100.000",
      unitPrice: "10.0000",
    });
    await prijemZoFaktury(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-2026-0009",
      receivedAt: "2026-07-10",
      invoiceId: faktura.id,
      polozky: [
        { materialId: zaklad.material.id, qty: "100.000", unitPrice: "10.0000" },
      ],
    });

    const zoznam = await fakturyNaParovanie(db);
    expect(zoznam.find((f) => f.invoiceNumber === "FA-PRIJATA")!.maPrijemku).toBe(
      true,
    );
  });
});
