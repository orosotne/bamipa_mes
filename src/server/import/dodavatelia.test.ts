// Import dodávateľov: kľúč zhody IČO (ak je), inak názov (case-insensitive).
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import {
  createSupplier,
  softDeleteSupplier,
} from "@/server/suppliers/service";
import { createTestDb, seedZaklad, type TestDb } from "@/test/pglite";
import { importujDodavatelov } from "./dodavatelia";

let db: TestDb;
let zaklad: Awaited<ReturnType<typeof seedZaklad>>;

beforeEach(async () => {
  ({ db } = await createTestDb());
  zaklad = await seedZaklad(db); // obsahuje dodávateľa "Test dodávateľ s.r.o." bez IČO
});

function vstup(text: string, prepisat = false) {
  return {
    userId: zaklad.adminId,
    text,
    rezim: prepisat ? ("aktualizovat" as const) : ("len_nove" as const),
    dryRun: false,
    nazovSuboru: "1-dodavatelia.csv",
  };
}

async function zivyDodavatelia() {
  return db
    .select()
    .from(schema.suppliers)
    .where(isNull(schema.suppliers.deletedAt));
}

describe("importujDodavatelov — vytvorenie", () => {
  test("dvaja noví dodávatelia + súhrnný audit záznam", async () => {
    const csv =
      "nazov;ico;dic;ic_dph;adresa;email;telefon;poznamka\n" +
      "Slovkaučuk s.r.o.;36123456;2021234567;SK2021234567;Nováky;a@b.sk;+421 46 1;kaučuky\n" +
      "Carbon Trade a.s.;31789012;;;;;;\n";

    const { chyby, prehlad } = await importujDodavatelov(db, vstup(csv));

    expect(chyby).toEqual([]);
    expect(prehlad).toEqual({ novych: 2, aktualizovanych: 0, preskocenych: 0 });

    const dodavatelia = await zivyDodavatelia();
    expect(dodavatelia).toHaveLength(3); // 1 zo seedu + 2 nové
    const slovkaucuk = dodavatelia.find((d) => d.ico === "36123456");
    expect(slovkaucuk?.name).toBe("Slovkaučuk s.r.o.");
    expect(slovkaucuk?.icDph).toBe("SK2021234567");
    const carbon = dodavatelia.find((d) => d.ico === "31789012");
    expect(carbon?.dic).toBeNull(); // prázdne voliteľné pole = NULL

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tableName, "csv_import"));
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("import");
    expect(audit[0].changes).toMatchObject({
      typ: "dodavatelia",
      rezim: "len_nove",
      subor: "1-dodavatelia.csv",
      novych: 2,
    });
  });

  test("dry-run nič nezapíše, počty sedia", async () => {
    const csv = "nazov\nNový dodávateľ s.r.o.\n";

    const { chyby, prehlad } = await importujDodavatelov(db, {
      ...vstup(csv),
      dryRun: true,
    });

    expect(chyby).toEqual([]);
    expect(prehlad).toEqual({ novych: 1, aktualizovanych: 0, preskocenych: 0 });
    expect(await zivyDodavatelia()).toHaveLength(1); // len seed
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tableName, "csv_import"));
    expect(audit).toEqual([]);
  });
});

describe("importujDodavatelov — zhoda s existujúcimi", () => {
  test("len_nove: zhodný názov (iná veľkosť písmen) → preskočený", async () => {
    const csv = "nazov;ico\nTEST DODÁVATEĽ s.r.o.;99999999\n";

    const { chyby, prehlad } = await importujDodavatelov(db, vstup(csv));

    expect(chyby).toEqual([]);
    expect(prehlad).toEqual({ novych: 0, aktualizovanych: 0, preskocenych: 1 });
    expect(await zivyDodavatelia()).toHaveLength(1);
  });

  test("zhoda podľa IČO má prednosť pred názvom", async () => {
    await db.insert(schema.suppliers).values({
      name: "Stará firma s.r.o.",
      ico: "36123456",
      createdBy: zaklad.adminId,
    });
    const csv = "nazov;ico\nNová firma s.r.o.;36123456\n";

    // len_nove: preskočí (existuje podľa IČO)
    const skip = await importujDodavatelov(db, vstup(csv));
    expect(skip.prehlad.preskocenych).toBe(1);

    // aktualizovat: prepíše názov na hodnotu zo súboru
    const upd = await importujDodavatelov(db, vstup(csv, true));
    expect(upd.chyby).toEqual([]);
    expect(upd.prehlad).toEqual({ novych: 0, aktualizovanych: 1, preskocenych: 0 });
    const [firma] = await db
      .select()
      .from(schema.suppliers)
      .where(
        and(eq(schema.suppliers.ico, "36123456"), isNull(schema.suppliers.deletedAt)),
      );
    expect(firma.name).toBe("Nová firma s.r.o.");
  });

  test("aktualizovat: prázdne pole v súbore ponechá existujúcu hodnotu", async () => {
    await db.insert(schema.suppliers).values({
      name: "Firma X s.r.o.",
      ico: "11112222",
      email: "stary@x.sk",
      createdBy: zaklad.adminId,
    });
    const csv = "nazov;ico;email;telefon\nFirma X s.r.o.;11112222;;+421 900 000 111\n";

    const { chyby } = await importujDodavatelov(db, vstup(csv, true));

    expect(chyby).toEqual([]);
    const [firma] = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.ico, "11112222"));
    expect(firma.email).toBe("stary@x.sk"); // prázdne pole nemaže
    expect(firma.phone).toBe("+421 900 000 111"); // vyplnené pole prepíše
  });
});

describe("importujDodavatelov — validácie", () => {
  test("prázdny názov → chyba s číslom riadku, nič sa nezapíše", async () => {
    const csv = "nazov;ico\nDobrá firma s.r.o.;22223333\n;44445555\n";

    const { chyby, prehlad } = await importujDodavatelov(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].riadok).toBe(3);
    expect(chyby[0].stlpec).toBe("nazov");
    expect(prehlad).toEqual({ novych: 0, aktualizovanych: 0, preskocenych: 0 });
    expect(await zivyDodavatelia()).toHaveLength(1); // ani dobrý riadok sa nezapísal
  });

  test("duplicitné IČO v súbore → chyba s odkazom na prvý výskyt", async () => {
    const csv = "nazov;ico\nFirma A;36123456\nFirma B;36123456\n";

    const { chyby } = await importujDodavatelov(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].riadok).toBe(3);
    expect(chyby[0].sprava).toContain("2");
  });

  test("duplicitný názov v súbore (bez IČO) → chyba", async () => {
    const csv = "nazov\nFirma A s.r.o.\nfirma a S.R.O.\n";

    const { chyby } = await importujDodavatelov(db, vstup(csv));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].riadok).toBe(3);
  });

  test("chyba hlavičky sa propaguje", async () => {
    const { chyby } = await importujDodavatelov(db, vstup("meno\nFirma\n"));

    expect(chyby.length).toBeGreaterThan(0);
    expect(chyby[0].riadok).toBe(1);
  });

  test("unique index: duplicitný názov (case/trim variant) → slovenská chyba", async () => {
    await createSupplier(db, { userId: zaklad.adminId, name: "Gumex SK" });

    await expect(
      createSupplier(db, { userId: zaklad.adminId, name: "  gumex sk " }),
    ).rejects.toThrow(/už existuje/);
  });

  test("unique index: duplicitné IČO pri inom názve → slovenská chyba", async () => {
    await createSupplier(db, {
      userId: zaklad.adminId,
      name: "Firma A",
      ico: "11223344",
    });

    await expect(
      createSupplier(db, {
        userId: zaklad.adminId,
        name: "Firma B",
        ico: "11223344",
      }),
    ).rejects.toThrow(/už existuje/);
  });

  test("unique index: viac dodávateľov bez IČO je v poriadku, zmazaný uvoľní názov", async () => {
    const a = await createSupplier(db, { userId: zaklad.adminId, name: "Bez ICO 1" });
    await createSupplier(db, { userId: zaklad.adminId, name: "Bez ICO 2" });

    await softDeleteSupplier(db, { userId: zaklad.adminId, id: a.id });
    await expect(
      createSupplier(db, { userId: zaklad.adminId, name: "Bez ICO 1" }),
    ).resolves.toBeTruthy();
  });

  test("dva riadky trafia ten istý DB záznam cez rôzne kľúče → chyba + rollback", async () => {
    await db.insert(schema.suppliers).values({
      name: "ABC s.r.o.",
      ico: "12345678",
      createdBy: zaklad.adminId,
    });
    // riadok 2 sa zhoduje názvom, riadok 3 IČO-m — ten istý záznam
    const csv = "nazov;ico\nABC s.r.o.;\nABC spol.;12345678\n";

    const { chyby, prehlad } = await importujDodavatelov(db, vstup(csv, true));

    expect(chyby).toHaveLength(1);
    expect(chyby[0].riadok).toBe(3);
    expect(prehlad).toEqual({ novych: 0, aktualizovanych: 0, preskocenych: 0 });
    const [abc] = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.ico, "12345678"));
    expect(abc.name).toBe("ABC s.r.o."); // nič sa neprepísalo
  });
});
