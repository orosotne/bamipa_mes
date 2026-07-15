// M5 Labák — správa tolerančných limitov per zmes (lab_test_definitions). TDD.
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { type LabParametreMapa, seedLabParametre } from "./fixtures";
import { limityPreZmes, ulozLimit } from "./definitions";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;
let params: LabParametreMapa;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db);
  params = await seedLabParametre(db, zaklad.adminId);
});

describe("ulozLimit", () => {
  test("vytvorí nový limit", async () => {
    const row = await ulozLimit(db, {
      userId: zaklad.adminId,
      mixtureId: zaklad.zmes.id,
      parameterId: params.ML.id,
      minValue: "5,0",
      maxValue: "10",
    });
    expect(row).not.toBeNull();
    expect(row!.minValue).toBe("5.000");
    expect(row!.maxValue).toBe("10.000");
  });

  test("úprava existujúceho = upsert, nevytvorí duplikát", async () => {
    await ulozLimit(db, {
      userId: zaklad.adminId,
      mixtureId: zaklad.zmes.id,
      parameterId: params.ML.id,
      minValue: "5.000",
      maxValue: "10.000",
    });
    await ulozLimit(db, {
      userId: zaklad.adminId,
      mixtureId: zaklad.zmes.id,
      parameterId: params.ML.id,
      minValue: "6.000",
      maxValue: "12.000",
    });

    const zive = await db
      .select()
      .from(schema.labTestDefinitions)
      .where(
        and(
          eq(schema.labTestDefinitions.mixtureId, zaklad.zmes.id),
          eq(schema.labTestDefinitions.parameterId, params.ML.id),
          isNull(schema.labTestDefinitions.deletedAt),
        ),
      );
    expect(zive).toHaveLength(1);
    expect(zive[0].minValue).toBe("6.000");
    expect(zive[0].maxValue).toBe("12.000");
  });

  test("len min (max prázdny) je povolený", async () => {
    const row = await ulozLimit(db, {
      userId: zaklad.adminId,
      mixtureId: zaklad.zmes.id,
      parameterId: params.TS2.id,
      minValue: "1.000",
      maxValue: "",
    });
    expect(row!.minValue).toBe("1.000");
    expect(row!.maxValue).toBeNull();
  });

  test("obe prázdne → zruší (soft delete) existujúci limit", async () => {
    await ulozLimit(db, {
      userId: zaklad.adminId,
      mixtureId: zaklad.zmes.id,
      parameterId: params.ML.id,
      minValue: "5.000",
      maxValue: "10.000",
    });
    const vysledok = await ulozLimit(db, {
      userId: zaklad.adminId,
      mixtureId: zaklad.zmes.id,
      parameterId: params.ML.id,
      minValue: "",
      maxValue: null,
    });
    expect(vysledok).toBeNull();

    const zive = await db
      .select()
      .from(schema.labTestDefinitions)
      .where(
        and(
          eq(schema.labTestDefinitions.mixtureId, zaklad.zmes.id),
          eq(schema.labTestDefinitions.parameterId, params.ML.id),
          isNull(schema.labTestDefinitions.deletedAt),
        ),
      );
    expect(zive).toHaveLength(0);
  });

  test("min > max → slovenská chyba", async () => {
    await expect(
      ulozLimit(db, {
        userId: zaklad.adminId,
        mixtureId: zaklad.zmes.id,
        parameterId: params.ML.id,
        minValue: "10.000",
        maxValue: "5.000",
      }),
    ).rejects.toThrow(/maxim|minim/i);
  });

  test("limit mimo rozsahu numeric(10,3) → slovenská chyba", async () => {
    await expect(
      ulozLimit(db, {
        userId: zaklad.adminId,
        mixtureId: zaklad.zmes.id,
        parameterId: params.ML.id,
        minValue: "99999999",
        maxValue: "",
      }),
    ).rejects.toThrow(/rozsah/i);
  });
});

describe("limityPreZmes", () => {
  test("vracia všetky aktívne parametre v poradí, nedefinované s null", async () => {
    await ulozLimit(db, {
      userId: zaklad.adminId,
      mixtureId: zaklad.zmes.id,
      parameterId: params.ML.id,
      minValue: "5.000",
      maxValue: "10.000",
    });

    const riadky = await limityPreZmes(db, zaklad.zmes.id);
    expect(riadky).toHaveLength(7);
    // poradie podľa sort_order
    expect(riadky.map((r) => r.code)).toEqual([
      "ML",
      "MH",
      "TS2",
      "T90",
      "PEVNOST",
      "TAZNOST",
      "TVRDOST",
    ]);
    const ml = riadky.find((r) => r.code === "ML")!;
    expect(ml.minValue).toBe("5.000");
    expect(ml.maxValue).toBe("10.000");
    const mh = riadky.find((r) => r.code === "MH")!;
    expect(mh.minValue).toBeNull();
    expect(mh.maxValue).toBeNull();
    expect(mh.definitionId).toBeNull();
  });
});
