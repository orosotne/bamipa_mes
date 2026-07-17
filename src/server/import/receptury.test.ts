// Import receptúr: 1 riadok = 1 položka, zoskupenie podľa kod_zmesi.
// Vždy vzniká NOVÁ verzia cez createRecipeVersion (nemennosť verzií).
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { importujReceptury } from "./receptury";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;
let olej: typeof schema.materials.$inferSelect;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // zmes ZMES-A s receptúrou v1, materiál SADZE-N330
  [olej] = await db
    .insert(schema.materials)
    .values({
      code: "TDAE",
      name: "Zmäkčovadlo TDAE",
      unit: "kg",
      category: "olej",
      createdBy: zaklad.adminId,
    })
    .returning();
});

function vstup(text: string, prepisat = false) {
  return {
    userId: zaklad.adminId,
    text,
    rezim: prepisat ? ("aktualizovat" as const) : ("len_nove" as const),
    dryRun: false,
    nazovSuboru: "3-receptury.csv",
  };
}

const HLAVICKA =
  "kod_zmesi;nazov_zmesi;standardna_davka_kg;tech_poznamka;kod_materialu;mnozstvo_kg;poradie\n";

describe("importujReceptury — nová zmes", () => {
  test("založí zmes + verziu 1, položky podľa poradia", async () => {
    const csv =
      HLAVICKA +
      "NOVA-B;Zmes B svetlá;100;miešať 10 min;TDAE;15,25;2\n" +
      "NOVA-B;;;;SADZE-N330;50,5;1\n";

    const { chyby, prehlad } = await importujReceptury(db, vstup(csv));

    expect(chyby).toEqual([]);
    expect(prehlad).toEqual({ novych: 1, aktualizovanych: 0, preskocenych: 0 });

    const [zmes] = await db
      .select()
      .from(schema.mixtures)
      .where(eq(schema.mixtures.code, "NOVA-B"));
    expect(zmes.name).toBe("Zmes B svetlá");

    const [recept] = await db
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.mixtureId, zmes.id));
    expect(recept.version).toBe(1);
    expect(recept.isActive).toBe(true);
    expect(recept.standardBatchKg).toBe("100.000");
    expect(recept.techNotes).toBe("miešať 10 min");

    const polozky = await db
      .select()
      .from(schema.recipeItems)
      .where(eq(schema.recipeItems.recipeId, recept.id))
      .orderBy(asc(schema.recipeItems.sortOrder));
    expect(polozky).toHaveLength(2);
    // poradie 1 = SADZE-N330, poradie 2 = TDAE (v súbore boli naopak)
    expect(polozky[0].materialId).toBe(zaklad.material.id);
    expect(polozky[0].qtyKg).toBe("50.500");
    expect(polozky[1].materialId).toBe(olej.id);
    expect(polozky[1].qtyKg).toBe("15.250");
  });

  test("bez stĺpca poradie platí poradie riadkov", async () => {
    const csv =
      "kod_zmesi;nazov_zmesi;standardna_davka_kg;kod_materialu;mnozstvo_kg\n" +
      "NOVA-C;Zmes C;80;TDAE;10\n" +
      "NOVA-C;;;SADZE-N330;20\n";

    const { chyby } = await importujReceptury(db, vstup(csv));

    expect(chyby).toEqual([]);
    const [zmes] = await db
      .select()
      .from(schema.mixtures)
      .where(eq(schema.mixtures.code, "NOVA-C"));
    const [recept] = await db
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.mixtureId, zmes.id));
    const polozky = await db
      .select()
      .from(schema.recipeItems)
      .where(eq(schema.recipeItems.recipeId, recept.id))
      .orderBy(asc(schema.recipeItems.sortOrder));
    expect(polozky[0].materialId).toBe(olej.id);
    expect(polozky[1].materialId).toBe(zaklad.material.id);
  });

  test("dry-run nič nezapíše", async () => {
    const csv = HLAVICKA + "NOVA-D;Zmes D;50;;TDAE;5;\n";

    const { chyby, prehlad } = await importujReceptury(db, {
      ...vstup(csv),
      dryRun: true,
    });

    expect(chyby).toEqual([]);
    expect(prehlad.novych).toBe(1);
    const zmesi = await db
      .select()
      .from(schema.mixtures)
      .where(eq(schema.mixtures.code, "NOVA-D"));
    expect(zmesi).toEqual([]);
  });
});

describe("importujReceptury — existujúce zmesi", () => {
  test("len_nove: zmes s receptúrou → preskočená, verzia nevznikne", async () => {
    const csv = HLAVICKA + "ZMES-A;Zmes A;120;;TDAE;10;\n";

    const { chyby, prehlad } = await importujReceptury(db, vstup(csv));

    expect(chyby).toEqual([]);
    expect(prehlad).toEqual({ novych: 0, aktualizovanych: 0, preskocenych: 1 });
    const recepty = await db
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.mixtureId, zaklad.zmes.id));
    expect(recepty).toHaveLength(1); // len pôvodná v1
  });

  test("len_nove: existujúca zmes BEZ receptúry → verzia 1 (nové)", async () => {
    const [holaZmes] = await db
      .insert(schema.mixtures)
      .values({ code: "HOLA", name: "Holá zmes", createdBy: zaklad.adminId })
      .returning();
    const csv = HLAVICKA + "HOLA;;90;;TDAE;12;\n"; // nazov_zmesi netreba, zmes existuje

    const { chyby, prehlad } = await importujReceptury(db, vstup(csv));

    expect(chyby).toEqual([]);
    expect(prehlad).toEqual({ novych: 1, aktualizovanych: 0, preskocenych: 0 });
    const recepty = await db
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.mixtureId, holaZmes.id));
    expect(recepty).toHaveLength(1);
    expect(recepty[0].version).toBe(1);
  });

  test("aktualizovat: nová verzia max+1, stará sa deaktivuje, názov sa prepíše", async () => {
    const csv = HLAVICKA + "ZMES-A;Zmes A premium;110;;TDAE;10;\n";

    const { chyby, prehlad } = await importujReceptury(db, vstup(csv, true));

    expect(chyby).toEqual([]);
    expect(prehlad).toEqual({ novych: 0, aktualizovanych: 1, preskocenych: 0 });

    const recepty = await db
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.mixtureId, zaklad.zmes.id))
      .orderBy(asc(schema.recipes.version));
    expect(recepty).toHaveLength(2);
    expect(recepty[0].isActive).toBe(false);
    expect(recepty[1].version).toBe(2);
    expect(recepty[1].isActive).toBe(true);
    expect(recepty[1].standardBatchKg).toBe("110.000");

    const [zmes] = await db
      .select()
      .from(schema.mixtures)
      .where(eq(schema.mixtures.id, zaklad.zmes.id));
    expect(zmes.name).toBe("Zmes A premium");
  });
});

describe("importujReceptury — validácie", () => {
  test("neznámy materiál → chyba s kódom", async () => {
    const csv = HLAVICKA + "NOVA-E;Zmes E;100;;NEEXISTUJE;10;\n";

    const { chyby } = await importujReceptury(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].stlpec).toBe("kod_materialu");
    expect(chyby[0].sprava).toContain("NEEXISTUJE");
  });

  test("materiál v ks → chyba (receptúry sú v kg, D6)", async () => {
    await db.insert(schema.materials).values({
      code: "KRAB-40",
      name: "Krabica",
      unit: "ks",
      category: "obalovy_material",
      createdBy: zaklad.adminId,
    });
    const csv = HLAVICKA + "NOVA-F;Zmes F;100;;KRAB-40;10;\n";

    const { chyby } = await importujReceptury(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].sprava).toMatch(/kg/);
  });

  test("duplicitný materiál v tej istej zmesi → chyba", async () => {
    const csv =
      HLAVICKA + "NOVA-G;Zmes G;100;;TDAE;10;\nNOVA-G;;;;TDAE;5;\n";

    const { chyby } = await importujReceptury(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].riadok).toBe(3);
  });

  test("nekonzistentná štandardná dávka v riadkoch zmesi → chyba", async () => {
    const csv =
      HLAVICKA + "NOVA-H;Zmes H;100;;TDAE;10;\nNOVA-H;;120;;SADZE-N330;5;\n";

    const { chyby } = await importujReceptury(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].riadok).toBe(3);
    expect(chyby[0].stlpec).toBe("standardna_davka_kg");
  });

  test("nová zmes bez názvu → chyba", async () => {
    const csv = HLAVICKA + "NOVA-I;;100;;TDAE;10;\n";

    const { chyby } = await importujReceptury(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].stlpec).toBe("nazov_zmesi");
  });

  test("chýbajúca štandardná dávka → chyba", async () => {
    const csv = HLAVICKA + "NOVA-J;Zmes J;;;TDAE;10;\n";

    const { chyby } = await importujReceptury(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].stlpec).toBe("standardna_davka_kg");
  });

  test("zlé množstvo → chyba so stĺpcom a riadkom", async () => {
    const csv = HLAVICKA + "NOVA-K;Zmes K;100;;TDAE;abc;\n";

    const { chyby } = await importujReceptury(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0]).toMatchObject({ riadok: 2, stlpec: "mnozstvo_kg" });
  });

  test("tech_poznamka: prvá neprázdna platí (riadky sa tíško neprepisujú)", async () => {
    const csv =
      HLAVICKA +
      "NOVA-P;Zmes P;100;prvá poznámka;TDAE;10;\n" +
      "NOVA-P;;;iná poznámka;SADZE-N330;5;\n";

    const { chyby } = await importujReceptury(db, vstup(csv));

    expect(chyby).toEqual([]);
    const [zmes] = await db
      .select()
      .from(schema.mixtures)
      .where(eq(schema.mixtures.code, "NOVA-P"));
    const [recept] = await db
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.mixtureId, zmes.id));
    expect(recept.techNotes).toBe("prvá poznámka");
  });

  test("audit záznam po úspešnom importe", async () => {
    const csv = HLAVICKA + "NOVA-L;Zmes L;100;;TDAE;10;\n";

    await importujReceptury(db, vstup(csv));

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tableName, "csv_import"));
    expect(audit).toHaveLength(1);
    expect(audit[0].changes).toMatchObject({ typ: "receptury", novych: 1 });
  });
});
