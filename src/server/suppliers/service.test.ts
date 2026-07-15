// Dodávatelia (M1): CRUD so soft delete guardom a audit trailom (SPEC §4).
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  createSupplier,
  listSuppliers,
  softDeleteSupplier,
  updateSupplier,
} from "./service";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // obsahuje 1 dodávateľa "Test dodávateľ s.r.o."
});

describe("createSupplier", () => {
  test("vytvorí dodávateľa a zapíše audit_log", async () => {
    const dodavatel = await createSupplier(db, {
      userId: zaklad.adminId,
      name: "Kaučuky SK a.s.",
      ico: "12345678",
      email: "objednavky@kaucuky.sk",
    });

    expect(dodavatel.name).toBe("Kaučuky SK a.s.");
    expect(dodavatel.ico).toBe("12345678");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.tableName, "suppliers"),
          eq(schema.auditLog.recordId, dodavatel.id),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("insert");
    expect(audit[0].changedBy).toBe(zaklad.adminId);
  });

  test("prázdne meno → slovenská chyba", async () => {
    await expect(
      createSupplier(db, { userId: zaklad.adminId, name: "   " }),
    ).rejects.toThrow(/[Nn]ázov/);
  });
});

describe("updateSupplier", () => {
  test("upraví polia a zapíše audit diff", async () => {
    const upraveny = await updateSupplier(db, {
      userId: zaklad.adminId,
      id: zaklad.dodavatel.id,
      name: "Test dodávateľ PLUS s.r.o.",
      phone: "+421 900 123 456",
    });

    expect(upraveny.name).toBe("Test dodávateľ PLUS s.r.o.");
    expect(upraveny.phone).toBe("+421 900 123 456");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.recordId, zaklad.dodavatel.id));
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("update");
  });

  test("neexistujúci dodávateľ → chyba", async () => {
    await expect(
      updateSupplier(db, {
        userId: zaklad.adminId,
        id: "00000000-0000-0000-0000-00000000dead",
        name: "X",
      }),
    ).rejects.toThrow();
  });
});

describe("listSuppliers", () => {
  test("zoradení podľa mena, bez zmazaných", async () => {
    await createSupplier(db, { userId: zaklad.adminId, name: "Alfa chemikálie" });
    const zmazany = await createSupplier(db, {
      userId: zaklad.adminId,
      name: "Zrušený dodávateľ",
    });
    await softDeleteSupplier(db, { userId: zaklad.adminId, id: zmazany.id });

    const zoznam = await listSuppliers(db);

    expect(zoznam.map((s) => s.name)).toEqual([
      "Alfa chemikálie",
      "Test dodávateľ s.r.o.",
    ]);
  });
});

describe("softDeleteSupplier", () => {
  test("bez faktúr → zmazaný (deleted_at) + audit", async () => {
    const novy = await createSupplier(db, {
      userId: zaklad.adminId,
      name: "Dočasný",
    });

    await softDeleteSupplier(db, { userId: zaklad.adminId, id: novy.id });

    const [riadok] = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, novy.id));
    expect(riadok.deletedAt).not.toBeNull();
  });

  test("s faktúrou → slovenská chyba a dodávateľ ostáva (guard z návrhu)", async () => {
    await db.insert(schema.invoices).values({
      supplierId: zaklad.dodavatel.id,
      invoiceNumber: "FA-X-1",
      dueDate: "2026-08-01",
      totalNetCents: 1000,
      totalVatCents: 200,
      totalGrossCents: 1200,
      createdBy: zaklad.adminId,
    });

    await expect(
      softDeleteSupplier(db, { userId: zaklad.adminId, id: zaklad.dodavatel.id }),
    ).rejects.toThrow(/fakt[úu]r/);

    const [riadok] = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, zaklad.dodavatel.id));
    expect(riadok.deletedAt).toBeNull();
  });
});
