// Šablóny z docs/import-sablony/ sú zároveň fixtures — vzorové riadky musia
// prejsť importom na čisto (šablóna sa nikdy nesmie rozísť s kódom importu).
import { readFileSync } from "node:fs";
import path from "node:path";
import { isNull } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/pglite";
import { importujArtikle } from "./artikle";
import { importujDodavatelov } from "./dodavatelia";
import { importujMaterialy } from "./materialy";
import { importujReceptury } from "./receptury";

const SABLONY = path.resolve(import.meta.dirname, "../../../docs/import-sablony");
const PUBLIC_SABLONY = path.resolve(import.meta.dirname, "../../../public/sablony");

const SUBORY = [
  "1-dodavatelia.csv",
  "2-materialy.csv",
  "3-receptury.csv",
  "4-artikle.csv",
] as const;

function sablona(nazov: string): string {
  return readFileSync(path.join(SABLONY, nazov), "utf8");
}

let db: TestDb;
const adminId = "00000000-0000-0000-0000-0000000000a1";

beforeEach(async () => {
  ({ db } = await createTestDb());
  await db
    .insert(schema.users)
    .values({ id: adminId, displayName: "Admin", role: "admin" });
});

function vstup(subor: string) {
  return {
    userId: adminId,
    text: sablona(subor),
    rezim: "len_nove" as const,
    dryRun: false,
    nazovSuboru: subor,
  };
}

async function importujVsetky() {
  return {
    dodavatelia: await importujDodavatelov(db, vstup("1-dodavatelia.csv")),
    materialy: await importujMaterialy(db, vstup("2-materialy.csv")),
    receptury: await importujReceptury(db, vstup("3-receptury.csv")),
    artikle: await importujArtikle(db, vstup("4-artikle.csv")),
  };
}

describe("šablóny docs/import-sablony", () => {
  test("všetky 4 šablóny prejdú na čisto v poradí importu", async () => {
    const vysledky = await importujVsetky();

    expect(vysledky.dodavatelia.chyby).toEqual([]);
    expect(vysledky.dodavatelia.prehlad.novych).toBe(3);
    expect(vysledky.materialy.chyby).toEqual([]);
    expect(vysledky.materialy.prehlad.novych).toBe(5);
    expect(vysledky.receptury.chyby).toEqual([]);
    expect(vysledky.receptury.prehlad.novych).toBe(2);
    expect(vysledky.artikle.chyby).toEqual([]);
    expect(vysledky.artikle.prehlad.novych).toBe(3);

    // Namátková kontrola dát: receptúra A-01 má 4 položky, artikel cenu v centoch.
    const zmesi = await db
      .select()
      .from(schema.mixtures)
      .where(isNull(schema.mixtures.deletedAt));
    expect(zmesi.map((z) => z.code).sort()).toEqual(["A-01", "B-02"]);
    const polozky = await db.select().from(schema.recipeItems);
    expect(polozky).toHaveLength(6);
    const artikle = await db.select().from(schema.soleModels);
    expect(artikle.find((a) => a.code === "TREK-01")?.salePriceCents).toBe(420);
    expect(
      artikle.find((a) => a.code === "TREK-02")?.targetCycleSeconds,
    ).toBeNull();
  });

  test("public/sablony na stiahnutie sú byte-identické s docs/ (drift-guard)", () => {
    // Stránka /ciselniky/sablony servuje public/sablony/*.csv; docs/ sú testom
    // overený zdroj pravdy — nesmú sa rozísť (inak by kolega stiahol iné, než
    // čo import očakáva).
    for (const subor of SUBORY) {
      const docs = readFileSync(path.join(SABLONY, subor), "utf8");
      const verejne = readFileSync(path.join(PUBLIC_SABLONY, subor), "utf8");
      expect(verejne).toBe(docs);
    }
  });

  test("opakovaný import v režime len_nove je idempotentný", async () => {
    await importujVsetky();
    const druhyKrat = await importujVsetky();

    for (const vysledok of Object.values(druhyKrat)) {
      expect(vysledok.chyby).toEqual([]);
      expect(vysledok.prehlad.novych).toBe(0);
      expect(vysledok.prehlad.aktualizovanych).toBe(0);
      expect(vysledok.prehlad.preskocenych).toBeGreaterThan(0);
    }

    const recepty = await db.select().from(schema.recipes);
    expect(recepty).toHaveLength(2); // žiadne nové verzie
  });
});
