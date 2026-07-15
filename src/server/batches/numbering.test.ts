// Číslovanie výrobných dávok valcovne: V-RRRR-NNNN, poradové per rok (M4, D6/D8).
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { generujCisloDavky } from "./numbering";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db);
});

async function davka(cislo: string) {
  await db.insert(schema.productionBatches).values({
    batchNumber: cislo,
    recipeId: zaklad.recept.id,
    productionDate: "2026-07-12",
    shift: "ranna",
    machineId: zaklad.stroj.id,
    leadWorkerId: zaklad.pracovnik.id,
    createdBy: zaklad.adminId,
  });
}

describe("generujCisloDavky", () => {
  test("prázdna DB → V-2026-0001", async () => {
    expect(await generujCisloDavky(db, 2026)).toBe("V-2026-0001");
  });

  test("pokračuje od najvyššieho čísla v roku", async () => {
    await davka("V-2026-0001");
    await davka("V-2026-0007"); // diera v číslovaní — pokračuje od max
    expect(await generujCisloDavky(db, 2026)).toBe("V-2026-0008");
  });

  test("iný rok začína od 0001", async () => {
    await davka("V-2026-0005");
    expect(await generujCisloDavky(db, 2027)).toBe("V-2027-0001");
  });

  test("nad 9999 sa číslovanie nezasekne (5-ciferné pokračuje ďalej)", async () => {
    await davka("V-2026-9999");
    expect(await generujCisloDavky(db, 2026)).toBe("V-2026-10000");
  });
});
