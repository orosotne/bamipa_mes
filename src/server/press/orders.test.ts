import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  seedLisovnaZaklad,
  type LisovnaZaklad,
  type Zaklad,
} from "./fixtures";
import { dokonciPrikaz, zalozPrikaz, zrusPrikaz } from "./orders";

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;

beforeEach(async () => {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
});

describe("zalozPrikaz", () => {
  test("založí príkaz s číslom PR-RRRR-NNNN v stave nova + audit", async () => {
    const prikaz = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 500,
      prepBranch: "barwell",
      note: "prvý príkaz",
    });

    expect(prikaz.orderNumber).toMatch(/^PR-\d{4}-0001$/);
    expect(prikaz.status).toBe("nova");
    expect(prikaz.prepBranch).toBe("barwell");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.recordId, prikaz.id));
    expect(audit).toHaveLength(1);
    expect(audit[0].tableName).toBe("work_orders");
  });

  test("druhý príkaz dostane nasledujúce číslo", async () => {
    const p1 = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 100,
    });
    const p2 = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 200,
    });
    expect(p1.orderNumber).not.toBe(p2.orderNumber);
    expect(p2.orderNumber).toMatch(/-0002$/);
  });

  test("nekladné množstvo párov je odmietnuté", async () => {
    await expect(
      zalozPrikaz(db, {
        userId: z.adminId,
        soleModelId: lz.artikel.id,
        qtyPairsPlanned: 0,
      }),
    ).rejects.toThrow(/párov musí byť kladné/);
  });

  test("neexistujúci artikel je odmietnutý", async () => {
    await expect(
      zalozPrikaz(db, {
        userId: z.adminId,
        soleModelId: "00000000-0000-0000-0000-000000000099",
        qtyPairsPlanned: 10,
      }),
    ).rejects.toThrow(/Artikel neexistuje/);
  });
});

describe("stavový automat príkazu", () => {
  test("zrusPrikaz: nova → zrusena + audit status_change", async () => {
    const prikaz = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 10,
    });
    const po = await zrusPrikaz(db, { userId: z.adminId, id: prikaz.id });
    expect(po.status).toBe("zrusena");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.recordId, prikaz.id));
    expect(audit.map((a) => a.action)).toContain("status_change");
  });

  test("dokonciPrikaz na stave nova zablokuje DB trigger (nova → dokoncena nie je povolený prechod)", async () => {
    const prikaz = await zalozPrikaz(db, {
      userId: z.adminId,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 10,
    });
    await expect(
      dokonciPrikaz(db, { userId: z.adminId, id: prikaz.id }),
    ).rejects.toSatisfy((e) =>
      plnaHlaska(e).includes("Neplatný prechod stavu príkazu"),
    );
  });

  test("priamy INSERT príkazu v inom stave než nova zablokuje DB trigger", async () => {
    await expect(
      db.insert(schema.workOrders).values({
        orderNumber: "PR-2026-0099",
        soleModelId: lz.artikel.id,
        qtyPairsPlanned: 10,
        status: "vo_vyrobe",
        createdBy: z.adminId,
      }),
    ).rejects.toSatisfy((e) =>
      plnaHlaska(e).includes("musí vzniknúť v stave"),
    );
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
