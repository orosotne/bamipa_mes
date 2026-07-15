// Číslovanie príjemok: P-RRRR-NNNN, poradové per rok (rozhodnutie z plánu M2).
import { beforeEach, describe, expect, test } from "vitest";
import { pociatocnyStav } from "@/server/inventory/receipts";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { generujCisloPrijemky } from "./numbering";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db);
});

async function prijemka(cislo: string) {
  await pociatocnyStav(db, {
    userId: zaklad.adminId,
    receiptNumber: cislo,
    receivedAt: "2026-07-01",
    polozky: [
      { materialId: zaklad.material.id, qty: "1.000", unitPrice: "1.0000" },
    ],
  });
}

describe("generujCisloPrijemky", () => {
  test("prázdna DB → P-2026-0001", async () => {
    expect(await generujCisloPrijemky(db, 2026)).toBe("P-2026-0001");
  });

  test("pokračuje od najvyššieho čísla v roku", async () => {
    await prijemka("P-2026-0001");
    await prijemka("P-2026-0007"); // diera v číslovaní — pokračuje od max
    expect(await generujCisloPrijemky(db, 2026)).toBe("P-2026-0008");
  });

  test("iný rok začína od 0001", async () => {
    await prijemka("P-2026-0005");
    expect(await generujCisloPrijemky(db, 2027)).toBe("P-2027-0001");
  });

  test("ručne zadané čísla mimo formátu nezavadzajú", async () => {
    await prijemka("P-INIT-STARY-SKLAD");
    expect(await generujCisloPrijemky(db, 2026)).toBe("P-2026-0001");
  });

  test("nad 9999 sa číslovanie nezasekne (5-ciferné pokračuje ďalej)", async () => {
    await prijemka("P-2026-9999");
    expect(await generujCisloPrijemky(db, 2026)).toBe("P-2026-10000");
    await prijemka("P-2026-10000");
    expect(await generujCisloPrijemky(db, 2026)).toBe("P-2026-10001");
  });
});
