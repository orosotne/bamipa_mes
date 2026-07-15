import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  seedLisovnaZaklad,
  type LisovnaZaklad,
  type Zaklad,
} from "./fixtures";
import { zalozPrikaz, zrusPrikaz } from "./orders";
import { zapisOrez, zmazOrez } from "./scrap";

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;
let prikazId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
  const prikaz = await zalozPrikaz(db, {
    userId: z.adminId,
    soleModelId: lz.artikel.id,
    qtyPairsPlanned: 100,
  });
  prikazId = prikaz.id;
});

describe("zapisOrez", () => {
  test("uloží kg odpadu per príkaz (D5)", async () => {
    const zaznam = await zapisOrez(db, {
      userId: z.adminId,
      workOrderId: prikazId,
      qtyKg: "4.250",
      recordDate: "2026-07-15",
      note: "pretoky z rannej zmeny",
    });
    expect(zaznam.qtyKg).toBe("4.250");
    expect(zaznam.workOrderId).toBe(prikazId);
  });

  test("nekladné kg sú odmietnuté", async () => {
    await expect(
      zapisOrez(db, {
        userId: z.adminId,
        workOrderId: prikazId,
        qtyKg: "0",
        recordDate: "2026-07-15",
      }),
    ).rejects.toThrow(/kladn/);
  });

  test("na zrušený príkaz nejde zapísať orez (DB trigger)", async () => {
    await zrusPrikaz(db, { userId: z.adminId, id: prikazId });
    await expect(
      zapisOrez(db, {
        userId: z.adminId,
        workOrderId: prikazId,
        qtyKg: "1.000",
        recordDate: "2026-07-15",
      }),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("zrusena"));
  });
});

describe("zmazOrez", () => {
  test("soft delete záznamu orezu + audit trail (SPEC §4)", async () => {
    const zaznam = await zapisOrez(db, {
      userId: z.adminId,
      workOrderId: prikazId,
      qtyKg: "2.000",
      recordDate: "2026-07-15",
    });
    await zmazOrez(db, { userId: z.adminId, id: zaznam.id });
    const [po] = await db
      .select()
      .from(schema.scrapRecords)
      .where(eq(schema.scrapRecords.id, zaznam.id));
    expect(po.deletedAt).not.toBeNull();

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.recordId, zaznam.id));
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("delete");
    expect(audit[0].changedBy).toBe(z.adminId);
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
