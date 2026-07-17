// Import materiálov: kľúč = kod; MJ/kategória tolerantné na diakritiku,
// predvoleni_dodavatelia (| oddelené, názov alebo IČO) plnia material_suppliers.
import { eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { importujMaterialy } from "./materialy";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // materiál SADZE-N330 (kg, plnivo, v receptúre)
});

function vstup(text: string, prepisat = false) {
  return {
    userId: zaklad.adminId,
    text,
    rezim: prepisat ? ("aktualizovat" as const) : ("len_nove" as const),
    dryRun: false,
    nazovSuboru: "2-materialy.csv",
  };
}

async function zivyMaterialy() {
  return db
    .select()
    .from(schema.materials)
    .where(isNull(schema.materials.deletedAt));
}

describe("importujMaterialy — vytvorenie", () => {
  test("nové materiály s MJ, kategóriou, min. zásobou a dodávateľmi", async () => {
    const csv =
      "kod;nazov;mj;kategoria;min_zasoba;predvoleni_dodavatelia;poznamka\n" +
      "SBR-1502;Kaučuk SBR 1502;kg;kaucuk;500;Test dodávateľ s.r.o.;balenie 25 kg\n" +
      "KRAB-40;Krabica 40×30;ks;obalovy_material;;;\n";

    const { chyby, prehlad } = await importujMaterialy(db, vstup(csv));

    expect(chyby).toEqual([]);
    expect(prehlad).toEqual({ novych: 2, aktualizovanych: 0, preskocenych: 0 });

    const materialy = await zivyMaterialy();
    expect(materialy).toHaveLength(3); // seed + 2
    const sbr = materialy.find((m) => m.code === "SBR-1502");
    expect(sbr?.unit).toBe("kg");
    expect(sbr?.category).toBe("kaucuk");
    expect(sbr?.minStockQty).toBe("500.000");
    const vazby = await db
      .select()
      .from(schema.materialSuppliers)
      .where(eq(schema.materialSuppliers.materialId, sbr!.id));
    expect(vazby).toHaveLength(1);
    expect(vazby[0].supplierId).toBe(zaklad.dodavatel.id);

    const krabica = materialy.find((m) => m.code === "KRAB-40");
    expect(krabica?.unit).toBe("ks");
    expect(krabica?.minStockQty).toBeNull();
  });

  test("MJ a kategória tolerujú veľkosť písmen a diakritiku", async () => {
    const csv =
      "kod;nazov;mj;kategoria\nOB-1;Fólia;KS;Obalový materiál\nCH-1;Síra;Kg;chemikália\n";

    const { chyby } = await importujMaterialy(db, vstup(csv));

    expect(chyby).toEqual([]);
    const materialy = await zivyMaterialy();
    expect(materialy.find((m) => m.code === "OB-1")?.category).toBe(
      "obalovy_material",
    );
    expect(materialy.find((m) => m.code === "CH-1")?.category).toBe("chemikalia");
  });

  test("min. zásoba s desatinnou čiarkou a medzerami", async () => {
    const csv = "kod;nazov;mj;kategoria;min_zasoba\nOL-1;Olej;kg;olej;1 250,5\n";

    const { chyby } = await importujMaterialy(db, vstup(csv));

    expect(chyby).toEqual([]);
    const materialy = await zivyMaterialy();
    expect(materialy.find((m) => m.code === "OL-1")?.minStockQty).toBe("1250.500");
  });

  test("dry-run nič nezapíše", async () => {
    const csv = "kod;nazov;mj;kategoria\nX-1;Nový;kg;ine\n";

    const { prehlad } = await importujMaterialy(db, { ...vstup(csv), dryRun: true });

    expect(prehlad.novych).toBe(1);
    expect(await zivyMaterialy()).toHaveLength(1);
  });
});

describe("importujMaterialy — validácie", () => {
  test("neznáma MJ a kategória → chyby so stĺpcom", async () => {
    const csv = "kod;nazov;mj;kategoria\nX-1;Zlý;tona;plnivo\nX-2;Zlý 2;kg;farbivo\n";

    const { chyby, prehlad } = await importujMaterialy(db, vstup(csv));

    expect(chyby).toHaveLength(2);
    expect(chyby[0]).toMatchObject({ riadok: 2, stlpec: "mj" });
    expect(chyby[0].sprava).toContain("tona");
    expect(chyby[1]).toMatchObject({ riadok: 3, stlpec: "kategoria" });
    expect(prehlad).toEqual({ novych: 0, aktualizovanych: 0, preskocenych: 0 });
    expect(await zivyMaterialy()).toHaveLength(1);
  });

  test("zlá min. zásoba → chyba so stĺpcom", async () => {
    const csv =
      "kod;nazov;mj;kategoria;min_zasoba\nX-1;A;kg;ine;abc\nX-2;B;kg;ine;1,2345\n";

    const { chyby } = await importujMaterialy(db, vstup(csv));

    expect(chyby).toHaveLength(2);
    expect(chyby.every((ch) => ch.stlpec === "min_zasoba")).toBe(true);
  });

  test("neznámy dodávateľ → chyba, nič sa nezapíše", async () => {
    const csv =
      "kod;nazov;mj;kategoria;predvoleni_dodavatelia\nX-1;A;kg;ine;Neexistujúca firma\n";

    const { chyby } = await importujMaterialy(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].stlpec).toBe("predvoleni_dodavatelia");
    expect(chyby[0].sprava).toContain("Neexistujúca firma");
    expect(await zivyMaterialy()).toHaveLength(1);
  });

  test("dodávateľa možno zadať aj IČO-m", async () => {
    await db
      .update(schema.suppliers)
      .set({ ico: "36123456" })
      .where(eq(schema.suppliers.id, zaklad.dodavatel.id));
    const csv =
      "kod;nazov;mj;kategoria;predvoleni_dodavatelia\nX-1;A;kg;ine;36123456\n";

    const { chyby } = await importujMaterialy(db, vstup(csv));

    expect(chyby).toEqual([]);
  });

  test("duplicitný kód v súbore → chyba", async () => {
    const csv = "kod;nazov;mj;kategoria\nX-1;A;kg;ine\nX-1;B;kg;ine\n";

    const { chyby } = await importujMaterialy(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].riadok).toBe(3);
  });
});

describe("importujMaterialy — existujúce záznamy", () => {
  test("len_nove: existujúci kód → preskočený bez zmeny", async () => {
    const csv = "kod;nazov;mj;kategoria\nSADZE-N330;Iný názov;kg;ine\n";

    const { chyby, prehlad } = await importujMaterialy(db, vstup(csv));

    expect(chyby).toEqual([]);
    expect(prehlad).toEqual({ novych: 0, aktualizovanych: 0, preskocenych: 1 });
    const [material] = await zivyMaterialy();
    expect(material.name).toBe("Sadze N330");
  });

  test("aktualizovat: prepíše vyplnené, prázdne ponechá", async () => {
    await db
      .update(schema.materials)
      .set({ minStockQty: "300.000", note: "pôvodná poznámka" })
      .where(eq(schema.materials.id, zaklad.material.id));
    const csv =
      "kod;nazov;mj;kategoria;min_zasoba;poznamka\nSADZE-N330;Sadze N330 premium;kg;plnivo;;\n";

    const { chyby, prehlad } = await importujMaterialy(db, vstup(csv, true));

    expect(chyby).toEqual([]);
    expect(prehlad).toEqual({ novych: 0, aktualizovanych: 1, preskocenych: 0 });
    const [material] = await zivyMaterialy();
    expect(material.name).toBe("Sadze N330 premium");
    expect(material.minStockQty).toBe("300.000"); // prázdne pole nemaže
    expect(material.note).toBe("pôvodná poznámka");
  });

  test("aktualizovat: vyplnení dodávatelia nahradia väzby, prázdni ponechajú", async () => {
    const [novy] = await db
      .insert(schema.suppliers)
      .values({ name: "Druhý dodávateľ a.s.", createdBy: zaklad.adminId })
      .returning();
    await db.insert(schema.materialSuppliers).values({
      materialId: zaklad.material.id,
      supplierId: zaklad.dodavatel.id,
      createdBy: zaklad.adminId,
    });

    // prázdny stĺpec → väzby ostávajú
    const bezZmeny = await importujMaterialy(
      db,
      vstup("kod;nazov;mj;kategoria;predvoleni_dodavatelia\nSADZE-N330;Sadze N330;kg;plnivo;\n", true),
    );
    expect(bezZmeny.chyby).toEqual([]);
    let vazby = await db
      .select()
      .from(schema.materialSuppliers)
      .where(eq(schema.materialSuppliers.materialId, zaklad.material.id));
    expect(vazby.map((v) => v.supplierId)).toEqual([zaklad.dodavatel.id]);

    // vyplnený stĺpec → replace
    const soZmenou = await importujMaterialy(
      db,
      vstup("kod;nazov;mj;kategoria;predvoleni_dodavatelia\nSADZE-N330;Sadze N330;kg;plnivo;Druhý dodávateľ a.s.\n", true),
    );
    expect(soZmenou.chyby).toEqual([]);
    vazby = await db
      .select()
      .from(schema.materialSuppliers)
      .where(eq(schema.materialSuppliers.materialId, zaklad.material.id));
    expect(vazby.map((v) => v.supplierId)).toEqual([novy.id]);
  });

  test("dry-run zachytí aj guard služby (zmena MJ) — kontrola = ostrý beh", async () => {
    // SADZE-N330 je v receptúre → zmena MJ musí padnúť UŽ pri kontrole.
    const csv = "kod;nazov;mj;kategoria\nSADZE-N330;Sadze N330;ks;plnivo\n";

    const { chyby, prehlad } = await importujMaterialy(db, {
      ...vstup(csv, true),
      dryRun: true,
    });

    expect(chyby).toHaveLength(1);
    expect(chyby[0].sprava).toMatch(/[Mm]ernú jednotku/);
    expect(prehlad).toEqual({ novych: 0, aktualizovanych: 0, preskocenych: 0 });
    const [material] = await zivyMaterialy();
    expect(material.unit).toBe("kg"); // dry-run transakcia sa rollbackla
  });

  test("predvoleni_dodavatelia obsahujúce len oddeľovač nemaže väzby", async () => {
    await db.insert(schema.materialSuppliers).values({
      materialId: zaklad.material.id,
      supplierId: zaklad.dodavatel.id,
      createdBy: zaklad.adminId,
    });
    const csv =
      "kod;nazov;mj;kategoria;predvoleni_dodavatelia\nSADZE-N330;Sadze N330;kg;plnivo;|\n";

    const { chyby } = await importujMaterialy(db, vstup(csv, true));

    expect(chyby).toEqual([]);
    const vazby = await db
      .select()
      .from(schema.materialSuppliers)
      .where(eq(schema.materialSuppliers.materialId, zaklad.material.id));
    expect(vazby).toHaveLength(1); // väzby ostali
  });

  test("transakčnosť: zákaz zmeny MJ zruší celý import vrátane dobrých riadkov", async () => {
    // SADZE-N330 je v receptúre (seed) → zmena MJ kg→ks musí zlyhať
    const csv =
      "kod;nazov;mj;kategoria\nNOVY-MAT;Nový materiál;kg;ine\nSADZE-N330;Sadze N330;ks;plnivo\n";

    const { chyby, prehlad } = await importujMaterialy(db, vstup(csv, true));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].riadok).toBe(3);
    expect(chyby[0].sprava).toMatch(/[Mm]ernú jednotku/);
    expect(prehlad).toEqual({ novych: 0, aktualizovanych: 0, preskocenych: 0 });
    const materialy = await zivyMaterialy();
    expect(materialy.find((m) => m.code === "NOVY-MAT")).toBeUndefined();
  });
});
