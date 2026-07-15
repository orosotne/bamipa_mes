import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  seedLisovnaZaklad,
  seedZmesB,
  type LisovnaZaklad,
  type Zaklad,
} from "./fixtures";
import { softDeleteArtikel, updateArtikel, vytvorArtikel } from "./articles";

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;

beforeEach(async () => {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
});

describe("vytvorArtikel", () => {
  test("založí artikel a zapíše audit_log", async () => {
    const artikel = await vytvorArtikel(db, {
      userId: z.adminId,
      code: "POD-200",
      name: "Podošva Alpine 200",
      mixtureId: z.zmes.id,
      mixtureKgPerPair: "0.920",
      targetCycleSeconds: 480,
      salePriceCents: 1250,
    });

    expect(artikel.code).toBe("POD-200");
    expect(artikel.mixtureKgPerPair).toBe("0.920");
    expect(artikel.salePriceCents).toBe(1250);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.recordId, artikel.id));
    expect(audit).toHaveLength(1);
    expect(audit[0].tableName).toBe("sole_models");
    expect(audit[0].action).toBe("insert");
  });

  test("duplicitný kód vyhodí slovenskú hlášku", async () => {
    await expect(
      vytvorArtikel(db, {
        userId: z.adminId,
        code: "POD-100", // existuje zo seedLisovnaZaklad
        name: "Duplikát",
        mixtureId: z.zmes.id,
        mixtureKgPerPair: "0.500",
      }),
    ).rejects.toThrow(/POD-100.*existuje/);
  });

  test("nekladná norma spotreby je odmietnutá", async () => {
    await expect(
      vytvorArtikel(db, {
        userId: z.adminId,
        code: "POD-300",
        name: "Chybný",
        mixtureId: z.zmes.id,
        mixtureKgPerPair: "0",
      }),
    ).rejects.toThrow(/[Nn]orma spotreby/);
  });
});

describe("updateArtikel", () => {
  test("upraví polia artikla", async () => {
    const upraveny = await updateArtikel(db, {
      userId: z.adminId,
      id: lz.artikel.id,
      code: "POD-100",
      name: "Podošva Trek 100 v2",
      mixtureId: z.zmes.id,
      mixtureKgPerPair: "0.900",
      salePriceCents: 999,
    });
    expect(upraveny.name).toBe("Podošva Trek 100 v2");
    expect(upraveny.mixtureKgPerPair).toBe("0.900");
    expect(upraveny.salePriceCents).toBe(999);
  });

  test("zmenu zmesi pri existujúcom príkaze zablokuje DB trigger", async () => {
    const { zmesB } = await seedZmesB(db, z, lz);
    await db.insert(schema.workOrders).values({
      orderNumber: "PR-2026-0001",
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 50,
      createdBy: z.adminId,
    });

    await expect(
      updateArtikel(db, {
        userId: z.adminId,
        id: lz.artikel.id,
        code: "POD-100",
        name: "Podošva Trek 100",
        mixtureId: zmesB.id,
        mixtureKgPerPair: "0.850",
      }),
    ).rejects.toSatisfy((e) =>
      plnaHlaska(e).includes("Zmes artiklu nemožno zmeniť"),
    );
  });
});

describe("softDeleteArtikel", () => {
  test("artikel bez príkazov sa dá zmazať a kód sa uvoľní", async () => {
    await softDeleteArtikel(db, { userId: z.adminId, id: lz.artikel.id });

    const [row] = await db
      .select()
      .from(schema.soleModels)
      .where(eq(schema.soleModels.id, lz.artikel.id));
    expect(row.deletedAt).not.toBeNull();

    // partial unique: kód zmazaného artikla je znovu použiteľný
    const novy = await vytvorArtikel(db, {
      userId: z.adminId,
      code: "POD-100",
      name: "Nová Podošva",
      mixtureId: z.zmes.id,
      mixtureKgPerPair: "0.700",
    });
    expect(novy.code).toBe("POD-100");
  });

  test("artikel s výrobným príkazom sa nedá zmazať", async () => {
    await db.insert(schema.workOrders).values({
      orderNumber: "PR-2026-0001",
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 50,
      createdBy: z.adminId,
    });

    await expect(
      softDeleteArtikel(db, { userId: z.adminId, id: lz.artikel.id }),
    ).rejects.toThrow(/existujú.*príkazy/);
  });
});

/** Spojí message reťazec chyby vrátane cause (DrizzleQueryError balí PG chybu). */
function plnaHlaska(e: unknown): string {
  const casti: string[] = [];
  let cur = e as { message?: string; cause?: unknown } | undefined;
  while (cur) {
    if (typeof cur.message === "string") casti.push(cur.message);
    cur = cur.cause as { message?: string; cause?: unknown } | undefined;
  }
  return casti.join(" | ");
}
