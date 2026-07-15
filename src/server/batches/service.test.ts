// Výrobné dávky valcovne (M4): založenie z aktívneho receptu, atomický
// multi-materiálový výdaj, práca so snapshotom sadzby, prestoje, časy,
// odovzdanie na labák (stavový automat vynucuje DB trigger — over aj appkou).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { NedostatokZasobyError } from "@/server/inventory/fifo";
import { pociatocnyStav } from "@/server/inventory/receipts";
import { pridajSadzbu } from "@/server/workers/service";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  aktualizujCasy,
  odovzdajNaLabak,
  pridajPracu,
  pridajPrestoj,
  vydajNavazkuDavky,
  zalozDavku,
  zmazPrestoj,
} from "./service";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db);
});

/** Rozpracovaná dávka z aktívneho receptu zaklad.zmes (recept má 1 položku: zaklad.material). */
async function novaDavka(cislo = "V-2026-0001", scaleFactor?: string) {
  return zalozDavku(db, {
    userId: zaklad.adminId,
    batchNumber: cislo,
    mixtureId: zaklad.zmes.id,
    productionDate: "2026-07-12",
    shift: "ranna",
    machineId: zaklad.stroj.id,
    leadWorkerId: zaklad.pracovnik.id,
    scaleFactor,
  });
}

describe("zalozDavku", () => {
  test("založí dávku z aktívnej verzie receptu zmesi, stav rozpracovana", async () => {
    const davka = await novaDavka("V-2026-0001", "2.000");

    expect(davka.status).toBe("rozpracovana");
    expect(davka.recipeId).toBe(zaklad.recept.id);
    expect(davka.scaleFactor).toBe("2.000");
    expect(davka.batchNumber).toBe("V-2026-0001");
  });

  test("bez scale factora → default 1", async () => {
    const davka = await novaDavka();
    expect(davka.scaleFactor).toBe("1.000");
  });

  test("audit_log zapísaný pri založení", async () => {
    const davka = await novaDavka();
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.recordId, davka.id));
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("insert");
  });

  test("zmes bez aktívneho receptu → slovenská chyba", async () => {
    const [inaZmes] = await db
      .insert(schema.mixtures)
      .values({ code: "BEZ-REC", name: "Bez receptu", createdBy: zaklad.adminId })
      .returning();

    await expect(
      zalozDavku(db, {
        userId: zaklad.adminId,
        batchNumber: "V-2026-0002",
        mixtureId: inaZmes.id,
        productionDate: "2026-07-12",
        shift: "ranna",
        machineId: zaklad.stroj.id,
        leadWorkerId: zaklad.pracovnik.id,
      }),
    ).rejects.toThrow(/recept/);
  });

  test("neplatná zmena → chyba", async () => {
    await expect(
      zalozDavku(db, {
        userId: zaklad.adminId,
        batchNumber: "V-2026-0003",
        mixtureId: zaklad.zmes.id,
        productionDate: "2026-07-12",
        shift: "poludnajsia",
        machineId: zaklad.stroj.id,
        leadWorkerId: zaklad.pracovnik.id,
      }),
    ).rejects.toThrow(/[Zz]men/);
  });

  test("nulový/záporný scale factor → chyba", async () => {
    await expect(novaDavka("V-2026-0004", "0")).rejects.toThrow(/factor/);
  });
});

describe("vydajNavazkuDavky", () => {
  test("vydá viac materiálov v jednej transakcii", async () => {
    await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-001",
      receivedAt: "2026-07-01",
      polozky: [
        { materialId: zaklad.material.id, qty: "200.000", unitPrice: "40.0000" },
      ],
    });
    const [druhyMaterial] = await db
      .insert(schema.materials)
      .values({ code: "OLEJ-1", name: "Olej 1", unit: "kg", category: "olej", createdBy: zaklad.adminId })
      .returning();
    await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-002",
      receivedAt: "2026-07-01",
      polozky: [{ materialId: druhyMaterial.id, qty: "50.000", unitPrice: "10.0000" }],
    });

    const davka = await novaDavka();

    const vysledok = await vydajNavazkuDavky(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      polozky: [
        { materialId: zaklad.material.id, qty: "50.000" },
        { materialId: druhyMaterial.id, qty: "20.000" },
      ],
    });

    expect(vysledok.pohyby).toHaveLength(2);
    expect(vysledok.pohyby.every((p) => p.batchId === davka.id)).toBe(true);
  });

  test("nedostatok pri JEDNOM materiáli → žiadny pohyb pre celú navážku (atomicita)", async () => {
    await pociatocnyStav(db, {
      userId: zaklad.adminId,
      receiptNumber: "P-001",
      receivedAt: "2026-07-01",
      polozky: [
        { materialId: zaklad.material.id, qty: "200.000", unitPrice: "40.0000" },
      ],
    });
    const [druhyMaterial] = await db
      .insert(schema.materials)
      .values({ code: "OLEJ-1", name: "Olej 1", unit: "kg", category: "olej", createdBy: zaklad.adminId })
      .returning(); // bez skladovej zásoby

    const davka = await novaDavka();

    await expect(
      vydajNavazkuDavky(db, {
        userId: zaklad.adminId,
        batchId: davka.id,
        polozky: [
          { materialId: zaklad.material.id, qty: "50.000" }, // dostupné
          { materialId: druhyMaterial.id, qty: "10.000" }, // nedostatok
        ],
      }),
    ).rejects.toThrow(NedostatokZasobyError);

    const pohyby = await db
      .select()
      .from(schema.stockMoves)
      .where(eq(schema.stockMoves.batchId, davka.id));
    expect(pohyby).toHaveLength(0);
  });
});

describe("pridajPracu", () => {
  test("zapíše hodiny so snapshotom sadzby k work_date", async () => {
    await pridajSadzbu(db, {
      userId: zaklad.adminId,
      workerId: zaklad.pracovnik.id,
      hourlyRateCents: 850,
      validFrom: "2026-01-01",
    });
    const davka = await novaDavka();

    const zaznam = await pridajPracu(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      workerId: zaklad.pracovnik.id,
      workDate: "2026-07-12",
      hours: "8.00",
    });

    expect(zaznam.hourlyRateCents).toBe(850);
    expect(zaznam.hours).toBe("8.00");
  });

  test("pracovník bez platnej sadzby → chyba", async () => {
    const davka = await novaDavka();
    await expect(
      pridajPracu(db, {
        userId: zaklad.adminId,
        batchId: davka.id,
        workerId: zaklad.pracovnik.id,
        workDate: "2026-07-12",
        hours: "4.00",
      }),
    ).rejects.toThrow(/sadzb/);
  });
});

describe("pridajPrestoj / zmazPrestoj", () => {
  test("pridá prestoj s dôvodom a minútami", async () => {
    const davka = await novaDavka();
    const [dovod] = await db
      .insert(schema.downtimeReasons)
      .values({ code: "porucha", name: "Porucha", createdBy: zaklad.adminId })
      .returning();

    const prestoj = await pridajPrestoj(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      reasonId: dovod.id,
      minutes: 15,
    });

    expect(prestoj.minutes).toBe(15);
    expect(prestoj.batchId).toBe(davka.id);
  });

  test("nulové/záporné minúty → chyba", async () => {
    const davka = await novaDavka();
    const [dovod] = await db
      .insert(schema.downtimeReasons)
      .values({ code: "ine", name: "Iné", createdBy: zaklad.adminId })
      .returning();

    await expect(
      pridajPrestoj(db, { userId: zaklad.adminId, batchId: davka.id, reasonId: dovod.id, minutes: 0 }),
    ).rejects.toThrow();
  });

  test("zmazPrestoj: soft delete", async () => {
    const davka = await novaDavka();
    const [dovod] = await db
      .insert(schema.downtimeReasons)
      .values({ code: "prestavba", name: "Prestavba", createdBy: zaklad.adminId })
      .returning();
    const prestoj = await pridajPrestoj(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      reasonId: dovod.id,
      minutes: 10,
    });

    await zmazPrestoj(db, { userId: zaklad.adminId, id: prestoj.id });

    const [riadok] = await db
      .select()
      .from(schema.batchDowntimes)
      .where(eq(schema.batchDowntimes.id, prestoj.id));
    expect(riadok.deletedAt).not.toBeNull();
  });
});

describe("aktualizujCasy", () => {
  test("nastaví work_minutes", async () => {
    const davka = await novaDavka();
    const upravena = await aktualizujCasy(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      workMinutes: 120,
    });
    expect(upravena.workMinutes).toBe(120);
  });

  test("nulové/záporné minúty → chyba", async () => {
    const davka = await novaDavka();
    await expect(
      aktualizujCasy(db, { userId: zaklad.adminId, batchId: davka.id, workMinutes: 0 }),
    ).rejects.toThrow();
  });
});

describe("odovzdajNaLabak", () => {
  test("prechod rozpracovana → caka_na_labak s output_kg", async () => {
    const davka = await novaDavka();
    const upravena = await odovzdajNaLabak(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      outputKg: "98.500",
    });

    expect(upravena.status).toBe("caka_na_labak");
    expect(upravena.outputKg).toBe("98.500");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.recordId, davka.id));
    expect(audit.some((a) => a.action === "status_change")).toBe(true);
  });

  test("nulové/záporné output_kg → chyba", async () => {
    const davka = await novaDavka();
    await expect(
      odovzdajNaLabak(db, { userId: zaklad.adminId, batchId: davka.id, outputKg: "0" }),
    ).rejects.toThrow();
  });

  test("zo schválenej dávky späť na labák → DB trigger zablokuje neplatný prechod", async () => {
    const davka = await novaDavka();
    await odovzdajNaLabak(db, { userId: zaklad.adminId, batchId: davka.id, outputKg: "98.500" });
    await db.insert(schema.labTests).values({
      batchId: davka.id,
      sequenceNo: 1,
      verdict: "schvalene",
      verdictBy: zaklad.adminId,
      verdictAt: new Date(),
      createdBy: zaklad.adminId,
    });
    await db
      .update(schema.productionBatches)
      .set({ status: "schvalena" })
      .where(eq(schema.productionBatches.id, davka.id));

    // DB trigger zabalený cez Drizzle nemá čistú top-level hlášku (Failed
    // query: ...) — kontrolujeme len zamietnutie, nie presný text (ten je
    // v .cause reťazci, rovnako ako sqlState()).
    await expect(
      odovzdajNaLabak(db, { userId: zaklad.adminId, batchId: davka.id, outputKg: "99.000" }),
    ).rejects.toThrow();
  });
});

describe("zámok stavu — mutácie po odovzdaní na labák sú zakázané (server-side, nielen UI)", () => {
  test("vydajNavazkuDavky na dávke mimo rozpracovana → chyba", async () => {
    const davka = await novaDavka();
    await odovzdajNaLabak(db, { userId: zaklad.adminId, batchId: davka.id, outputKg: "50.000" });

    await expect(
      vydajNavazkuDavky(db, {
        userId: zaklad.adminId,
        batchId: davka.id,
        polozky: [{ materialId: zaklad.material.id, qty: "10.000" }],
      }),
    ).rejects.toThrow(/uzamknut/);
  });

  test("pridajPracu na dávke mimo rozpracovana → chyba", async () => {
    await pridajSadzbu(db, {
      userId: zaklad.adminId,
      workerId: zaklad.pracovnik.id,
      hourlyRateCents: 850,
      validFrom: "2026-01-01",
    });
    const davka = await novaDavka();
    await odovzdajNaLabak(db, { userId: zaklad.adminId, batchId: davka.id, outputKg: "50.000" });

    await expect(
      pridajPracu(db, {
        userId: zaklad.adminId,
        batchId: davka.id,
        workerId: zaklad.pracovnik.id,
        workDate: "2026-07-12",
        hours: "1.00",
      }),
    ).rejects.toThrow(/uzamknut/);
  });

  test("pridajPrestoj na dávke mimo rozpracovana → chyba", async () => {
    const davka = await novaDavka();
    await odovzdajNaLabak(db, { userId: zaklad.adminId, batchId: davka.id, outputKg: "50.000" });
    const [dovod] = await db
      .insert(schema.downtimeReasons)
      .values({ code: "porucha", name: "Porucha", createdBy: zaklad.adminId })
      .returning();

    await expect(
      pridajPrestoj(db, { userId: zaklad.adminId, batchId: davka.id, reasonId: dovod.id, minutes: 5 }),
    ).rejects.toThrow(/uzamknut/);
  });

  test("zmazPrestoj na dávke mimo rozpracovana → chyba (prestoj zapísaný ešte v rozpracovanej)", async () => {
    const davka = await novaDavka();
    const [dovod] = await db
      .insert(schema.downtimeReasons)
      .values({ code: "ine", name: "Iné", createdBy: zaklad.adminId })
      .returning();
    const prestoj = await pridajPrestoj(db, {
      userId: zaklad.adminId,
      batchId: davka.id,
      reasonId: dovod.id,
      minutes: 5,
    });
    await odovzdajNaLabak(db, { userId: zaklad.adminId, batchId: davka.id, outputKg: "50.000" });

    await expect(
      zmazPrestoj(db, { userId: zaklad.adminId, id: prestoj.id }),
    ).rejects.toThrow(/uzamknut/);
  });

  test("aktualizujCasy na dávke mimo rozpracovana → chyba", async () => {
    const davka = await novaDavka();
    await odovzdajNaLabak(db, { userId: zaklad.adminId, batchId: davka.id, outputKg: "50.000" });

    await expect(
      aktualizujCasy(db, { userId: zaklad.adminId, batchId: davka.id, workMinutes: 30 }),
    ).rejects.toThrow(/uzamknut/);
  });
});
