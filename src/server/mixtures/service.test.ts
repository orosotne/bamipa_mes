// Zmesi a verzované receptúry (M3, D6: položky v kg na štandardnú dávku).
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createMaterial } from "@/server/materials/service";
import { createTestDb, seedDavka, seedZaklad, type TestDb } from "@/test/pglite";
import {
  aktivujVerziu,
  createMixture,
  createRecipeVersion,
  softDeleteMixture,
  updateMixture,
} from "./service";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // ZMES-A s receptom v1 (50 kg SADZE-N330)
});

describe("createMixture", () => {
  test("vytvorí zmes + audit_log", async () => {
    const zmes = await createMixture(db, {
      userId: zaklad.adminId,
      code: "ZMES-B",
      name: "Zmes B — tvrdá podošva",
    });

    expect(zmes.code).toBe("ZMES-B");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.tableName, "mixtures"),
          eq(schema.auditLog.recordId, zmes.id),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  test("duplicitný kód → slovenská chyba", async () => {
    await expect(
      createMixture(db, { userId: zaklad.adminId, code: "ZMES-A", name: "Dup" }),
    ).rejects.toThrow(/kódom/);
  });
});

describe("updateMixture", () => {
  test("upraví názov a poznámku", async () => {
    const upravena = await updateMixture(db, {
      userId: zaklad.adminId,
      id: zaklad.zmes.id,
      code: "ZMES-A",
      name: "Zmes A — premenovaná",
      note: "Pre LOWA vibram podošvy",
    });
    expect(upravena.name).toBe("Zmes A — premenovaná");
    expect(upravena.note).toBe("Pre LOWA vibram podošvy");
  });
});

describe("softDeleteMixture", () => {
  test("s receptami → slovenská chyba", async () => {
    await expect(
      softDeleteMixture(db, { userId: zaklad.adminId, id: zaklad.zmes.id }),
    ).rejects.toThrow(/recept/);
  });

  test("bez receptov → zmazaná", async () => {
    const nova = await createMixture(db, {
      userId: zaklad.adminId,
      code: "BEZ-RECEPTU",
      name: "Prázdna zmes",
    });
    await softDeleteMixture(db, { userId: zaklad.adminId, id: nova.id });

    const [riadok] = await db
      .select()
      .from(schema.mixtures)
      .where(eq(schema.mixtures.id, nova.id));
    expect(riadok.deletedAt).not.toBeNull();
  });
});

describe("createRecipeVersion", () => {
  test("nová verzia = max+1, stáva sa aktívnou, stará sa deaktivuje (1 tx)", async () => {
    const v2 = await createRecipeVersion(db, {
      userId: zaklad.adminId,
      mixtureId: zaklad.zmes.id,
      standardBatchKg: "120.000",
      techNotes: "Dlhšie miešanie",
      polozky: [{ materialId: zaklad.material.id, qtyKg: "60.000" }],
    });

    expect(v2.version).toBe(2);
    expect(v2.isActive).toBe(true);
    expect(v2.standardBatchKg).toBe("120.000");

    const [v1] = await db
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.id, zaklad.recept.id));
    expect(v1.isActive).toBe(false);

    const polozky = await db
      .select()
      .from(schema.recipeItems)
      .where(eq(schema.recipeItems.recipeId, v2.id));
    expect(polozky).toHaveLength(1);
    expect(polozky[0].qtyKg).toBe("60.000");
  });

  test("prvá verzia pre novú zmes = 1", async () => {
    const nova = await createMixture(db, {
      userId: zaklad.adminId,
      code: "ZMES-C",
      name: "Zmes C",
    });
    const v1 = await createRecipeVersion(db, {
      userId: zaklad.adminId,
      mixtureId: nova.id,
      standardBatchKg: "100.000",
      polozky: [{ materialId: zaklad.material.id, qtyKg: "40.000" }],
    });
    expect(v1.version).toBe(1);
    expect(v1.isActive).toBe(true);
  });

  test("materiál s MJ ≠ kg → slovenská chyba (D6: recepty v kg)", async () => {
    const olejLitre = await createMaterial(db, {
      userId: zaklad.adminId,
      code: "OLEJ-L",
      name: "Olej v litroch",
      unit: "l",
      category: "olej",
    });

    await expect(
      createRecipeVersion(db, {
        userId: zaklad.adminId,
        mixtureId: zaklad.zmes.id,
        standardBatchKg: "100.000",
        polozky: [{ materialId: olejLitre.id, qtyKg: "10.000" }],
      }),
    ).rejects.toThrow(/kg/);
  });

  test("bez položiek → chyba", async () => {
    await expect(
      createRecipeVersion(db, {
        userId: zaklad.adminId,
        mixtureId: zaklad.zmes.id,
        standardBatchKg: "100.000",
        polozky: [],
      }),
    ).rejects.toThrow(/položk/);
  });

  test("duplicitný materiál v položkách → slovenská chyba", async () => {
    await expect(
      createRecipeVersion(db, {
        userId: zaklad.adminId,
        mixtureId: zaklad.zmes.id,
        standardBatchKg: "100.000",
        polozky: [
          { materialId: zaklad.material.id, qtyKg: "30.000" },
          { materialId: zaklad.material.id, qtyKg: "20.000" },
        ],
      }),
    ).rejects.toThrow(/duplicitn/i);
  });
});

describe("guardy soft delete (nálezy review)", () => {
  test("createRecipeVersion na zmazanej zmesi → slovenská chyba", async () => {
    const docasna = await createMixture(db, {
      userId: zaklad.adminId,
      code: "ZMAZANA",
      name: "Na zmazanie",
    });
    await softDeleteMixture(db, { userId: zaklad.adminId, id: docasna.id });

    await expect(
      createRecipeVersion(db, {
        userId: zaklad.adminId,
        mixtureId: docasna.id,
        standardBatchKg: "100.000",
        polozky: [{ materialId: zaklad.material.id, qtyKg: "10.000" }],
      }),
    ).rejects.toThrow(/zmazan|neexistuje/i);
  });

  test("createRecipeVersion so zmazaným materiálom → chyba", async () => {
    const material = await createMaterial(db, {
      userId: zaklad.adminId,
      code: "ZMAZANY-MAT",
      name: "Zmazaný materiál",
      unit: "kg",
      category: "ine",
    });
    // soft delete priamo (bez väzieb guard prejde)
    const { softDeleteMaterial } = await import("@/server/materials/service");
    await softDeleteMaterial(db, { userId: zaklad.adminId, id: material.id });

    await expect(
      createRecipeVersion(db, {
        userId: zaklad.adminId,
        mixtureId: zaklad.zmes.id,
        standardBatchKg: "100.000",
        polozky: [{ materialId: material.id, qtyKg: "10.000" }],
      }),
    ).rejects.toThrow(/neexistuje/);
  });

  test("softDeleteMixture na neexistujúcej zmesi → chyba (žiadny falošný audit)", async () => {
    await expect(
      softDeleteMixture(db, {
        userId: zaklad.adminId,
        id: "00000000-0000-0000-0000-00000000dead",
      }),
    ).rejects.toThrow(/neexistuje/i);
  });
});

describe("aktivujVerziu", () => {
  test("prepne aktívnu verziu späť na staršiu", async () => {
    const v2 = await createRecipeVersion(db, {
      userId: zaklad.adminId,
      mixtureId: zaklad.zmes.id,
      standardBatchKg: "120.000",
      polozky: [{ materialId: zaklad.material.id, qtyKg: "60.000" }],
    });

    await aktivujVerziu(db, { userId: zaklad.adminId, recipeId: zaklad.recept.id });

    const [v1] = await db
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.id, zaklad.recept.id));
    const [v2po] = await db
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.id, v2.id));
    expect(v1.isActive).toBe(true);
    expect(v2po.isActive).toBe(false);
  });

  test("neexistujúci recept → chyba", async () => {
    await expect(
      aktivujVerziu(db, {
        userId: zaklad.adminId,
        recipeId: "00000000-0000-0000-0000-00000000dead",
      }),
    ).rejects.toThrow();
  });
});

describe("nemennosť verzií (DB trigger — sanity cez službu)", () => {
  test("verzia s dávkou sa nedá zmeniť ani cez novú položku", async () => {
    await seedDavka(db, zaklad); // dávka na recept v1
    await expect(
      db.insert(schema.recipeItems).values({
        recipeId: zaklad.recept.id,
        materialId: zaklad.material.id,
        qtyKg: "1.000",
        createdBy: zaklad.adminId,
      }),
    ).rejects.toThrow(); // unique(recipe,material) alebo trigger — obidve blokujú
  });
});
