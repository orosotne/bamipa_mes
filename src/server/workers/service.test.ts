// Pracovníci + hodinové sadzby (M4 číselník): CRUD, história sadzieb, guardy.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedDavka, seedZaklad, type TestDb } from "@/test/pglite";
import {
  createWorker,
  listSadzby,
  listWorkers,
  pridajSadzbu,
  sadzbaKDatumu,
  softDeleteWorker,
  updateWorker,
} from "./service";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // obsahuje 1 pracovníka "Ján Testovací"
});

describe("createWorker", () => {
  test("vytvorí pracovníka + audit_log", async () => {
    const pracovnik = await createWorker(db, {
      userId: zaklad.adminId,
      fullName: "Peter Nový",
    });

    expect(pracovnik.fullName).toBe("Peter Nový");
    expect(pracovnik.isActive).toBe(true);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.tableName, "workers"),
          eq(schema.auditLog.recordId, pracovnik.id),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("insert");
  });

  test("prázdne meno → slovenská chyba", async () => {
    await expect(
      createWorker(db, { userId: zaklad.adminId, fullName: "   " }),
    ).rejects.toThrow(/[Mm]eno/);
  });
});

describe("updateWorker", () => {
  test("upraví meno a isActive + audit", async () => {
    const upraveny = await updateWorker(db, {
      userId: zaklad.adminId,
      id: zaklad.pracovnik.id,
      fullName: "Ján Testovací ml.",
      isActive: false,
    });

    expect(upraveny.fullName).toBe("Ján Testovací ml.");
    expect(upraveny.isActive).toBe(false);
  });

  test("neexistujúci pracovník → chyba", async () => {
    await expect(
      updateWorker(db, {
        userId: zaklad.adminId,
        id: "00000000-0000-0000-0000-00000000dead",
        fullName: "X",
        isActive: true,
      }),
    ).rejects.toThrow();
  });
});

describe("listWorkers", () => {
  test("aktívni pracovníci zoradení podľa mena, neaktívni vynechaní", async () => {
    await createWorker(db, { userId: zaklad.adminId, fullName: "Alena Prvá" });
    const neaktivny = await createWorker(db, {
      userId: zaklad.adminId,
      fullName: "Zoltán Posledný",
    });
    await updateWorker(db, {
      userId: zaklad.adminId,
      id: neaktivny.id,
      fullName: "Zoltán Posledný",
      isActive: false,
    });

    const zoznam = await listWorkers(db);

    expect(zoznam.map((w) => w.fullName)).toEqual([
      "Alena Prvá",
      "Ján Testovací",
    ]);
  });
});

describe("softDeleteWorker (guard z návrhu)", () => {
  test("bez dávok → zmazaný", async () => {
    const novy = await createWorker(db, {
      userId: zaklad.adminId,
      fullName: "Dočasný",
    });

    await softDeleteWorker(db, { userId: zaklad.adminId, id: novy.id });

    const [riadok] = await db
      .select()
      .from(schema.workers)
      .where(eq(schema.workers.id, novy.id));
    expect(riadok.deletedAt).not.toBeNull();
  });

  test("ako obsluha výrobnej dávky → slovenská chyba a pracovník ostáva", async () => {
    await seedDavka(db, zaklad); // leadWorkerId = zaklad.pracovnik.id

    await expect(
      softDeleteWorker(db, { userId: zaklad.adminId, id: zaklad.pracovnik.id }),
    ).rejects.toThrow(/dávk/);

    const [riadok] = await db
      .select()
      .from(schema.workers)
      .where(eq(schema.workers.id, zaklad.pracovnik.id));
    expect(riadok.deletedAt).toBeNull();
  });
});

describe("pridajSadzbu + sadzbaKDatumu", () => {
  test("pridá sadzbu a nájde ju k platnému dátumu", async () => {
    await pridajSadzbu(db, {
      userId: zaklad.adminId,
      workerId: zaklad.pracovnik.id,
      hourlyRateCents: 850,
      validFrom: "2026-01-01",
    });

    const sadzba = await sadzbaKDatumu(db, zaklad.pracovnik.id, "2026-07-12");
    expect(sadzba.hourlyRateCents).toBe(850);
  });

  test("história sadzieb: platí posledná so validFrom <= dátum (nie budúca)", async () => {
    await pridajSadzbu(db, {
      userId: zaklad.adminId,
      workerId: zaklad.pracovnik.id,
      hourlyRateCents: 800,
      validFrom: "2026-01-01",
    });
    await pridajSadzbu(db, {
      userId: zaklad.adminId,
      workerId: zaklad.pracovnik.id,
      hourlyRateCents: 900,
      validFrom: "2026-06-01",
    });
    await pridajSadzbu(db, {
      userId: zaklad.adminId,
      workerId: zaklad.pracovnik.id,
      hourlyRateCents: 1000,
      validFrom: "2027-01-01", // budúca — nesmie sa použiť pre 2026-07-12
    });

    const sadzba = await sadzbaKDatumu(db, zaklad.pracovnik.id, "2026-07-12");
    expect(sadzba.hourlyRateCents).toBe(900);
  });

  test("bez platnej sadzby k dátumu → slovenská chyba", async () => {
    await pridajSadzbu(db, {
      userId: zaklad.adminId,
      workerId: zaklad.pracovnik.id,
      hourlyRateCents: 800,
      validFrom: "2026-08-01", // až od augusta
    });

    await expect(
      sadzbaKDatumu(db, zaklad.pracovnik.id, "2026-07-12"),
    ).rejects.toThrow(/sadzb/);
  });

  test("nulová alebo záporná sadzba → chyba", async () => {
    await expect(
      pridajSadzbu(db, {
        userId: zaklad.adminId,
        workerId: zaklad.pracovnik.id,
        hourlyRateCents: 0,
        validFrom: "2026-01-01",
      }),
    ).rejects.toThrow();
  });

  test("listSadzby vráti históriu zoradenú od najnovšej", async () => {
    await pridajSadzbu(db, {
      userId: zaklad.adminId,
      workerId: zaklad.pracovnik.id,
      hourlyRateCents: 800,
      validFrom: "2026-01-01",
    });
    await pridajSadzbu(db, {
      userId: zaklad.adminId,
      workerId: zaklad.pracovnik.id,
      hourlyRateCents: 900,
      validFrom: "2026-06-01",
    });

    const zoznam = await listSadzby(db, zaklad.pracovnik.id);

    expect(zoznam.map((s) => s.hourlyRateCents)).toEqual([900, 800]);
  });
});
