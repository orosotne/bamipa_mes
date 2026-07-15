// Karty materiálov (M2): CRUD, predvolení dodávatelia (M2M), delete guardy.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { pociatocnyStav } from "@/server/inventory/receipts";
import {
  createMaterial,
  listMaterials,
  nastavPredvolenychDodavatelov,
  softDeleteMaterial,
  updateMaterial,
} from "./service";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // obsahuje materiál SADZE-N330 a recept, ktorý ho používa
});

describe("createMaterial", () => {
  test("vytvorí kartu materiálu + audit_log", async () => {
    const material = await createMaterial(db, {
      userId: zaklad.adminId,
      code: "OLEJ-P1",
      name: "Procesný olej P1",
      unit: "kg",
      category: "olej",
      minStockQty: "500.000",
    });

    expect(material.code).toBe("OLEJ-P1");
    expect(material.minStockQty).toBe("500.000");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.tableName, "materials"),
          eq(schema.auditLog.recordId, material.id),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("insert");
  });

  test("duplicitný kód → slovenská chyba", async () => {
    await expect(
      createMaterial(db, {
        userId: zaklad.adminId,
        code: "SADZE-N330", // existuje zo seedu
        name: "Duplicitné sadze",
        unit: "kg",
        category: "plnivo",
      }),
    ).rejects.toThrow(/kódom/);
  });

  test("prázdny kód alebo názov → chyba", async () => {
    await expect(
      createMaterial(db, {
        userId: zaklad.adminId,
        code: "  ",
        name: "X",
        unit: "kg",
        category: "ine",
      }),
    ).rejects.toThrow(/[Kk]ód/);
  });
});

describe("updateMaterial", () => {
  test("upraví polia + audit", async () => {
    const upraveny = await updateMaterial(db, {
      userId: zaklad.adminId,
      id: zaklad.material.id,
      code: "SADZE-N330",
      name: "Sadze N330 (granulát)",
      unit: "kg",
      category: "plnivo",
      minStockQty: "1000.000",
    });

    expect(upraveny.name).toBe("Sadze N330 (granulát)");
    expect(upraveny.minStockQty).toBe("1000.000");
  });
});

describe("updateMaterial — guard zmeny mernej jednotky", () => {
  test("zmena MJ materiálu so šaržami → slovenská chyba (reinterpretácia množstiev)", async () => {
    const novy = await createMaterial(db, {
      userId: zaklad.adminId,
      code: "MJ-GUARD",
      name: "Materiál s lotom",
      unit: "kg",
      category: "chemikalia",
    });
    await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-MJ-1",
      receivedAt: "2026-07-01",
      polozky: [{ materialId: novy.id, qty: "10.000", unitPrice: "5.0000" }],
    });

    await expect(
      updateMaterial(db, {
        userId: zaklad.adminId,
        id: novy.id,
        code: "MJ-GUARD",
        name: "Materiál s lotom",
        unit: "l", // zmena MJ
        category: "chemikalia",
      }),
    ).rejects.toThrow(/jednotku/);
  });

  test("zmena MJ materiálu v receptúre → chyba; bez väzieb je zmena OK", async () => {
    // zaklad.material je v recepte
    await expect(
      updateMaterial(db, {
        userId: zaklad.adminId,
        id: zaklad.material.id,
        code: "SADZE-N330",
        name: "Sadze N330",
        unit: "ks",
        category: "plnivo",
      }),
    ).rejects.toThrow(/jednotku/);

    const volny = await createMaterial(db, {
      userId: zaklad.adminId,
      code: "VOLNY",
      name: "Bez väzieb",
      unit: "kg",
      category: "ine",
    });
    const upraveny = await updateMaterial(db, {
      userId: zaklad.adminId,
      id: volny.id,
      code: "VOLNY",
      name: "Bez väzieb",
      unit: "l",
      category: "ine",
    });
    expect(upraveny.unit).toBe("l");
  });
});

describe("nastavPredvolenychDodavatelov (M2M replace)", () => {
  test("nastaví a prepíše zoznam predvolených dodávateľov", async () => {
    const [druhy] = await db
      .insert(schema.suppliers)
      .values({ name: "Druhý dodávateľ", createdBy: zaklad.adminId })
      .returning();

    await nastavPredvolenychDodavatelov(db, {
      userId: zaklad.adminId,
      materialId: zaklad.material.id,
      supplierIds: [zaklad.dodavatel.id],
    });
    await nastavPredvolenychDodavatelov(db, {
      userId: zaklad.adminId,
      materialId: zaklad.material.id,
      supplierIds: [druhy.id], // replace, nie append
    });

    const vazby = await db
      .select()
      .from(schema.materialSuppliers)
      .where(eq(schema.materialSuppliers.materialId, zaklad.material.id));
    expect(vazby).toHaveLength(1);
    expect(vazby[0].supplierId).toBe(druhy.id);
  });
});

describe("listMaterials", () => {
  test("aktívne materiály zoradené podľa kódu, s predvolenými dodávateľmi", async () => {
    await createMaterial(db, {
      userId: zaklad.adminId,
      code: "AAA-PRVY",
      name: "Abecedne prvý",
      unit: "ks",
      category: "obalovy_material",
    });
    await nastavPredvolenychDodavatelov(db, {
      userId: zaklad.adminId,
      materialId: zaklad.material.id,
      supplierIds: [zaklad.dodavatel.id],
    });

    const zoznam = await listMaterials(db);

    expect(zoznam.map((m) => m.code)).toEqual(["AAA-PRVY", "SADZE-N330"]);
    expect(zoznam[1].predvoleniDodavatelia).toEqual([zaklad.dodavatel.id]);
    expect(zoznam[0].predvoleniDodavatelia).toEqual([]);
  });
});

describe("softDeleteMaterial (guardy z návrhu)", () => {
  test("bez väzieb → zmazaný", async () => {
    const novy = await createMaterial(db, {
      userId: zaklad.adminId,
      code: "DOCASNY",
      name: "Dočasný materiál",
      unit: "l",
      category: "ine",
    });

    await softDeleteMaterial(db, { userId: zaklad.adminId, id: novy.id });

    const [riadok] = await db
      .select()
      .from(schema.materials)
      .where(eq(schema.materials.id, novy.id));
    expect(riadok.deletedAt).not.toBeNull();
  });

  test("so šaržou na sklade → slovenská chyba", async () => {
    const novy = await createMaterial(db, {
      userId: zaklad.adminId,
      code: "SO-SARZOU",
      name: "Materiál so šaržou",
      unit: "kg",
      category: "chemikalia",
    });
    await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-INIT",
      receivedAt: "2026-07-01",
      polozky: [{ materialId: novy.id, qty: "10.000", unitPrice: "100.0000" }],
    });

    await expect(
      softDeleteMaterial(db, { userId: zaklad.adminId, id: novy.id }),
    ).rejects.toThrow(/šarž/);
  });

  test("použitý v receptúre → slovenská chyba", async () => {
    // zaklad.material je položkou receptu zo seedu
    await expect(
      softDeleteMaterial(db, { userId: zaklad.adminId, id: zaklad.material.id }),
    ).rejects.toThrow(/recept/);
  });
});
