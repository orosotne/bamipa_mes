import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { seedLisovnaZaklad, type LisovnaZaklad, type Zaklad } from "./fixtures";
import { generujCisloDodacieho, generujCisloPrikazu } from "./numbering";

let db: TestDb;
let z: Zaklad;
let lz: LisovnaZaklad;

beforeEach(async () => {
  ({ db } = await createTestDb());
  z = await seedZaklad(db);
  lz = await seedLisovnaZaklad(db, z);
});

async function vlozPrikaz(cislo: string) {
  const [prikaz] = await db
    .insert(schema.workOrders)
    .values({
      orderNumber: cislo,
      soleModelId: lz.artikel.id,
      qtyPairsPlanned: 100,
      createdBy: z.adminId,
    })
    .returning();
  return prikaz;
}

describe("generujCisloPrikazu", () => {
  test("prvé číslo v roku je PR-RRRR-0001", async () => {
    expect(await generujCisloPrikazu(db, 2026)).toBe("PR-2026-0001");
  });

  test("pokračuje max+1 a ignoruje iné roky", async () => {
    await vlozPrikaz("PR-2025-0009");
    await vlozPrikaz("PR-2026-0041");
    expect(await generujCisloPrikazu(db, 2026)).toBe("PR-2026-0042");
  });

  test("číslo zmazaného príkazu sa nerecykluje", async () => {
    const prikaz = await vlozPrikaz("PR-2026-0001");
    await db
      .update(schema.workOrders)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workOrders.id, prikaz.id));
    expect(await generujCisloPrikazu(db, 2026)).toBe("PR-2026-0002");
  });
});

describe("generujCisloDodacieho", () => {
  test("prvé číslo v roku je DL-RRRR-0001", async () => {
    expect(await generujCisloDodacieho(db, 2026)).toBe("DL-2026-0001");
  });

  test("parsuje poradové číslo za 8-znakovým prefixom (DL-RRRR-)", async () => {
    await db.insert(schema.shipments).values({
      shipmentNumber: "DL-2026-0042",
      shipDate: "2026-07-15",
      customer: "LOWA",
      createdBy: z.adminId,
    });
    expect(await generujCisloDodacieho(db, 2026)).toBe("DL-2026-0043");
  });
});
