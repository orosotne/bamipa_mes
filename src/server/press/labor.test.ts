import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import {
  pripravSchvalenuDavku,
  seedLisovnaZaklad,
  type LisovnaZaklad,
  type Zaklad,
} from "./fixtures";
import { dokonciPrikaz, zalozPrikaz } from "./orders";
import { zapisVykon } from "./runs";
import { zapisPracu, zmazPracu } from "./labor";

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
  // sadzby: od januára 8,00 €/h, od júla 9,00 €/h
  await db.insert(schema.laborRates).values([
    {
      workerId: z.pracovnik.id,
      hourlyRateCents: 800,
      validFrom: "2026-01-01",
      createdBy: z.adminId,
    },
    {
      workerId: z.pracovnik.id,
      hourlyRateCents: 900,
      validFrom: "2026-07-01",
      createdBy: z.adminId,
    },
  ]);
});

describe("zapisPracu", () => {
  test("uloží prácu so snapshotom sadzby platnej k dátumu práce", async () => {
    const jun = await zapisPracu(db, {
      userId: z.adminId,
      workOrderId: prikazId,
      workerId: z.pracovnik.id,
      workDate: "2026-06-15",
      hours: "7.50",
    });
    expect(jun.hourlyRateCents).toBe(800);

    const jul = await zapisPracu(db, {
      userId: z.adminId,
      workOrderId: prikazId,
      workerId: z.pracovnik.id,
      workDate: "2026-07-15",
      hours: "8.00",
    });
    expect(jul.hourlyRateCents).toBe(900);
  });

  test("neskoršia zmena sadzby neprepíše snapshot", async () => {
    const zaznam = await zapisPracu(db, {
      userId: z.adminId,
      workOrderId: prikazId,
      workerId: z.pracovnik.id,
      workDate: "2026-07-15",
      hours: "8.00",
    });
    await db.insert(schema.laborRates).values({
      workerId: z.pracovnik.id,
      hourlyRateCents: 1100,
      validFrom: "2026-07-10",
      createdBy: z.adminId,
    });
    const [po] = await db
      .select()
      .from(schema.workOrderLabor)
      .where(eq(schema.workOrderLabor.id, zaznam.id));
    expect(po.hourlyRateCents).toBe(900);
  });

  test("pracovník bez sadzby je odmietnutý", async () => {
    const [novy] = await db
      .insert(schema.workers)
      .values({ fullName: "Bez Sadzby", createdBy: z.adminId })
      .returning();
    await expect(
      zapisPracu(db, {
        userId: z.adminId,
        workOrderId: prikazId,
        workerId: novy.id,
        workDate: "2026-07-15",
        hours: "1.00",
      }),
    ).rejects.toThrow(/nemá platnú sadzbu/);
  });

  test("na dokončený príkaz nejde zapísať práca (DB trigger)", async () => {
    const davka = await pripravSchvalenuDavku(db, z, lz);
    await zapisVykon(db, {
      userId: z.adminId,
      workOrderId: prikazId,
      machineId: lz.lis.id,
      batchId: davka.id,
      runDate: "2026-07-15",
      shift: "ranna",
      cyclesCount: 10,
      pairsProduced: 20,
      mixtureKg: "10.000",
      workerId: z.pracovnik.id,
    });
    await dokonciPrikaz(db, { userId: z.adminId, id: prikazId });

    await expect(
      zapisPracu(db, {
        userId: z.adminId,
        workOrderId: prikazId,
        workerId: z.pracovnik.id,
        workDate: "2026-07-15",
        hours: "1.00",
      }),
    ).rejects.toSatisfy((e) => plnaHlaska(e).includes("dokoncena"));
  });
});

describe("zmazPracu", () => {
  test("soft delete záznamu práce", async () => {
    const zaznam = await zapisPracu(db, {
      userId: z.adminId,
      workOrderId: prikazId,
      workerId: z.pracovnik.id,
      workDate: "2026-07-15",
      hours: "8.00",
    });
    await zmazPracu(db, { userId: z.adminId, id: zaznam.id });
    const [po] = await db
      .select()
      .from(schema.workOrderLabor)
      .where(eq(schema.workOrderLabor.id, zaznam.id));
    expect(po.deletedAt).not.toBeNull();
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
