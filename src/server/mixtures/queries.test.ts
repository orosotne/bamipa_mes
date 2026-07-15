// Čítacie queries receptúr (M3).
import { beforeEach, describe, expect, test } from "vitest";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { createMixture, createRecipeVersion } from "./service";
import { detailZmesi, zoznamZmesi } from "./queries";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // ZMES-A, recept v1 (50 kg SADZE), std 100 kg
});

describe("zoznamZmesi", () => {
  test("zoradené podľa kódu s aktívnou verziou a počtom položiek", async () => {
    await createMixture(db, {
      userId: zaklad.adminId,
      code: "AAA-ZMES",
      name: "Bez receptu",
    });

    const zoznam = await zoznamZmesi(db);

    expect(zoznam.map((z) => z.code)).toEqual(["AAA-ZMES", "ZMES-A"]);
    const zmesA = zoznam[1];
    expect(zmesA.aktivnaVerzia).toBe(1);
    expect(zmesA.standardBatchKg).toBe("100.000");
    expect(zmesA.pocetPoloziek).toBe(1);
    // zmes bez receptu
    expect(zoznam[0].aktivnaVerzia).toBeNull();
    expect(zoznam[0].pocetPoloziek).toBe(0);
  });
});

describe("detailZmesi", () => {
  test("vráti verzie DESC a položky aktívnej verzie s materiálmi", async () => {
    await createRecipeVersion(db, {
      userId: zaklad.adminId,
      mixtureId: zaklad.zmes.id,
      standardBatchKg: "120.000",
      techNotes: "Nová receptúra",
      polozky: [{ materialId: zaklad.material.id, qtyKg: "60.000" }],
    });

    const detail = await detailZmesi(db, zaklad.zmes.id);

    expect(detail.zmes.code).toBe("ZMES-A");
    expect(detail.verzie.map((v) => v.version)).toEqual([2, 1]);
    expect(detail.zvolena?.recipe.version).toBe(2); // default = aktívna
    expect(detail.zvolena?.polozky).toHaveLength(1);
    expect(detail.zvolena?.polozky[0].materialCode).toBe("SADZE-N330");
    expect(detail.zvolena?.polozky[0].qtyKg).toBe("60.000");
  });

  test("explicitná voľba staršej verzie", async () => {
    await createRecipeVersion(db, {
      userId: zaklad.adminId,
      mixtureId: zaklad.zmes.id,
      standardBatchKg: "120.000",
      polozky: [{ materialId: zaklad.material.id, qtyKg: "60.000" }],
    });

    const detail = await detailZmesi(db, zaklad.zmes.id, 1);

    expect(detail.zvolena?.recipe.version).toBe(1);
    expect(detail.zvolena?.polozky[0].qtyKg).toBe("50.000");
  });

  test("zmes bez receptov → zvolena je null", async () => {
    const nova = await createMixture(db, {
      userId: zaklad.adminId,
      code: "PRAZDNA",
      name: "Bez receptu",
    });

    const detail = await detailZmesi(db, nova.id);
    expect(detail.verzie).toHaveLength(0);
    expect(detail.zvolena).toBeNull();
  });

  test("neexistujúca zmes → chyba", async () => {
    await expect(
      detailZmesi(db, "00000000-0000-0000-0000-00000000dead"),
    ).rejects.toThrow();
  });

  test("soft-zmazaná zmes → chyba (stale URL nesmie fungovať)", async () => {
    const { createMixture, softDeleteMixture } = await import("./service");
    const docasna = await createMixture(db, {
      userId: zaklad.adminId,
      code: "NA-ZMAZANIE",
      name: "Dočasná",
    });
    await softDeleteMixture(db, { userId: zaklad.adminId, id: docasna.id });

    await expect(detailZmesi(db, docasna.id)).rejects.toThrow(/neexistuje/i);
  });

  test("neexistujúca explicitná verzia → fallback na aktívnu (nie prázdno)", async () => {
    const detail = await detailZmesi(db, zaklad.zmes.id, 99);
    expect(detail.zvolena?.recipe.version).toBe(1); // aktívna
  });
});
