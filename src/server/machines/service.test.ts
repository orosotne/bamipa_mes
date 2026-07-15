// Stroje (M4 číselník): CRUD so soft delete guardom a audit trailom.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedDavka, seedZaklad, type TestDb } from "@/test/pglite";
import {
  createMachine,
  listMachines,
  softDeleteMachine,
  updateMachine,
} from "./service";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // obsahuje 1 stroj "VAL1"
});

describe("createMachine", () => {
  test("vytvorí stroj + audit_log", async () => {
    const stroj = await createMachine(db, {
      userId: zaklad.adminId,
      code: "VAL2",
      name: "Valcovací stroj 2",
      costCenterId: zaklad.stredisko.id,
    });

    expect(stroj.code).toBe("VAL2");
    expect(stroj.isActive).toBe(true);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.tableName, "machines"),
          eq(schema.auditLog.recordId, stroj.id),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("insert");
  });

  test("duplicitný kód → slovenská chyba", async () => {
    await expect(
      createMachine(db, {
        userId: zaklad.adminId,
        code: "VAL1", // existuje zo seedu
        name: "Duplicitný stroj",
        costCenterId: zaklad.stredisko.id,
      }),
    ).rejects.toThrow(/kódom/);
  });

  test("prázdny kód alebo názov → chyba", async () => {
    await expect(
      createMachine(db, {
        userId: zaklad.adminId,
        code: "  ",
        name: "X",
        costCenterId: zaklad.stredisko.id,
      }),
    ).rejects.toThrow(/[Kk]ód/);
  });
});

describe("updateMachine", () => {
  test("upraví polia (vrátane isActive) + audit", async () => {
    const upraveny = await updateMachine(db, {
      userId: zaklad.adminId,
      id: zaklad.stroj.id,
      code: "VAL1",
      name: "Valcovací stroj 1 (nový motor)",
      costCenterId: zaklad.stredisko.id,
      isActive: false,
    });

    expect(upraveny.name).toBe("Valcovací stroj 1 (nový motor)");
    expect(upraveny.isActive).toBe(false);
  });

  test("neexistujúci stroj → chyba", async () => {
    await expect(
      updateMachine(db, {
        userId: zaklad.adminId,
        id: "00000000-0000-0000-0000-00000000dead",
        code: "X",
        name: "X",
        costCenterId: zaklad.stredisko.id,
        isActive: true,
      }),
    ).rejects.toThrow();
  });
});

describe("listMachines", () => {
  test("aktívne stroje zoradené podľa kódu, neaktívne/zmazané vynechané", async () => {
    await createMachine(db, {
      userId: zaklad.adminId,
      code: "AAA1",
      name: "Abecedne prvý",
      costCenterId: zaklad.stredisko.id,
    });
    const neaktivny = await createMachine(db, {
      userId: zaklad.adminId,
      code: "ZZZ9",
      name: "Vyradený",
      costCenterId: zaklad.stredisko.id,
    });
    await updateMachine(db, {
      userId: zaklad.adminId,
      id: neaktivny.id,
      code: "ZZZ9",
      name: "Vyradený",
      costCenterId: zaklad.stredisko.id,
      isActive: false,
    });

    const zoznam = await listMachines(db);

    expect(zoznam.map((m) => m.code)).toEqual(["AAA1", "VAL1"]);
  });
});

describe("softDeleteMachine (guard z návrhu)", () => {
  test("bez dávok → zmazaný", async () => {
    const novy = await createMachine(db, {
      userId: zaklad.adminId,
      code: "DOCASNY",
      name: "Dočasný stroj",
      costCenterId: zaklad.stredisko.id,
    });

    await softDeleteMachine(db, { userId: zaklad.adminId, id: novy.id });

    const [riadok] = await db
      .select()
      .from(schema.machines)
      .where(eq(schema.machines.id, novy.id));
    expect(riadok.deletedAt).not.toBeNull();
  });

  test("s výrobnou dávkou → slovenská chyba a stroj ostáva", async () => {
    await seedDavka(db, zaklad);

    await expect(
      softDeleteMachine(db, { userId: zaklad.adminId, id: zaklad.stroj.id }),
    ).rejects.toThrow(/dávk/);

    const [riadok] = await db
      .select()
      .from(schema.machines)
      .where(eq(schema.machines.id, zaklad.stroj.id));
    expect(riadok.deletedAt).toBeNull();
  });
});
