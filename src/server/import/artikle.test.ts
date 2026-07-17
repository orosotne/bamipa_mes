// Import artiklov podošiev: kľúč = kod, zmes referencovaná kódom,
// predajná cena v € s desatinnou čiarkou → centy (integer).
import { eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { importujArtikle } from "./artikle";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // zmes ZMES-A
});

function vstup(text: string, prepisat = false) {
  return {
    userId: zaklad.adminId,
    text,
    rezim: prepisat ? ("aktualizovat" as const) : ("len_nove" as const),
    dryRun: false,
    nazovSuboru: "4-artikle.csv",
  };
}

const HLAVICKA =
  "kod;nazov;kod_zmesi;norma_kg_na_par;cielovy_cas_cyklu_s;predajna_cena_eur\n";

async function zivyArtikle() {
  return db
    .select()
    .from(schema.soleModels)
    .where(isNull(schema.soleModels.deletedAt));
}

describe("importujArtikle — vytvorenie", () => {
  test("nové artikle: norma, cyklus, cena v centoch", async () => {
    const csv =
      HLAVICKA +
      "TREK-01;Podošva Trekking 01;ZMES-A;0,450;540;4,20\n" +
      "CITY-10;Podošva City 10;ZMES-A;0,380;;\n";

    const { chyby, prehlad } = await importujArtikle(db, vstup(csv));

    expect(chyby).toEqual([]);
    expect(prehlad).toEqual({ novych: 2, aktualizovanych: 0, preskocenych: 0 });

    const artikle = await zivyArtikle();
    const trek = artikle.find((a) => a.code === "TREK-01");
    expect(trek?.mixtureId).toBe(zaklad.zmes.id);
    expect(trek?.mixtureKgPerPair).toBe("0.450");
    expect(trek?.targetCycleSeconds).toBe(540);
    expect(trek?.salePriceCents).toBe(420);
    const city = artikle.find((a) => a.code === "CITY-10");
    expect(city?.targetCycleSeconds).toBeNull();
    expect(city?.salePriceCents).toBeNull();

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tableName, "csv_import"));
    expect(audit).toHaveLength(1);
    expect(audit[0].changes).toMatchObject({ typ: "artikle", novych: 2 });
  });

  test("cena s tisícovou medzerou: 1 234,56 → 123456 centov", async () => {
    const csv = HLAVICKA + "LUX-01;Luxusná podošva;ZMES-A;1,2;;1 234,56\n";

    const { chyby } = await importujArtikle(db, vstup(csv));

    expect(chyby).toEqual([]);
    const artikle = await zivyArtikle();
    expect(artikle[0].salePriceCents).toBe(123456);
  });

  test("dry-run nič nezapíše", async () => {
    const csv = HLAVICKA + "TREK-01;Podošva;ZMES-A;0,5;;\n";

    const { prehlad } = await importujArtikle(db, { ...vstup(csv), dryRun: true });

    expect(prehlad.novych).toBe(1);
    expect(await zivyArtikle()).toEqual([]);
  });
});

describe("importujArtikle — validácie", () => {
  test("neznáma zmes → chyba", async () => {
    const csv = HLAVICKA + "TREK-01;Podošva;NEEXISTUJE;0,5;;\n";

    const { chyby } = await importujArtikle(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].stlpec).toBe("kod_zmesi");
    expect(chyby[0].sprava).toContain("NEEXISTUJE");
    expect(await zivyArtikle()).toEqual([]);
  });

  test("zlá norma, cyklus aj cena → chyby so stĺpcami", async () => {
    const csv =
      HLAVICKA +
      "A-1;A;ZMES-A;abc;;\n" +
      "A-2;B;ZMES-A;0,5;12,5;\n" +
      "A-3;C;ZMES-A;0,5;;zadarmo\n" +
      "A-4;D;ZMES-A;-1;;\n";

    const { chyby } = await importujArtikle(db, vstup(csv));

    expect(chyby).toHaveLength(4);
    expect(chyby[0]).toMatchObject({ riadok: 2, stlpec: "norma_kg_na_par" });
    expect(chyby[1]).toMatchObject({ riadok: 3, stlpec: "cielovy_cas_cyklu_s" });
    expect(chyby[2]).toMatchObject({ riadok: 4, stlpec: "predajna_cena_eur" });
    expect(chyby[3]).toMatchObject({ riadok: 5, stlpec: "norma_kg_na_par" });
  });

  test("duplicitný kód v súbore → chyba", async () => {
    const csv = HLAVICKA + "A-1;A;ZMES-A;0,5;;\nA-1;B;ZMES-A;0,6;;\n";

    const { chyby } = await importujArtikle(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].riadok).toBe(3);
  });

  test("cyklus 0 aj pretečenie int4 padnú už pri kontrole (dry-run)", async () => {
    const csv =
      HLAVICKA +
      "A-1;A;ZMES-A;0,5;0;\n" +
      "A-2;B;ZMES-A;0,5;99999999999;\n";

    const { chyby } = await importujArtikle(db, { ...vstup(csv), dryRun: true });

    expect(chyby).toHaveLength(2);
    expect(chyby.every((ch) => ch.stlpec === "cielovy_cas_cyklu_s")).toBe(true);
  });
});

describe("importujArtikle — existujúce záznamy", () => {
  test("len_nove preskočí, aktualizovat prepíše (prázdne polia ponechá)", async () => {
    await db.insert(schema.soleModels).values({
      code: "TREK-01",
      name: "Stará podošva",
      mixtureId: zaklad.zmes.id,
      mixtureKgPerPair: "0.400",
      salePriceCents: 999,
      createdBy: zaklad.adminId,
    });
    const csv = HLAVICKA + "TREK-01;Nová podošva;ZMES-A;0,450;;\n";

    const skip = await importujArtikle(db, vstup(csv));
    expect(skip.prehlad).toEqual({ novych: 0, aktualizovanych: 0, preskocenych: 1 });

    const upd = await importujArtikle(db, vstup(csv, true));
    expect(upd.chyby).toEqual([]);
    expect(upd.prehlad).toEqual({ novych: 0, aktualizovanych: 1, preskocenych: 0 });

    const [artikel] = await zivyArtikle();
    expect(artikel.name).toBe("Nová podošva");
    expect(artikel.mixtureKgPerPair).toBe("0.450");
    expect(artikel.salePriceCents).toBe(999); // prázdna cena nemaže
  });
});
