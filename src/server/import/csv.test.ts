// CSV parser pre D10 importy: BOM, autodetekcia oddeľovača (; aj ,),
// quoted polia (RFC 4180), tolerantné hlavičky (case/diakritika).
import { describe, expect, test } from "vitest";
import { parseCsv } from "./csv";

const STLPCE = {
  povinne: ["kod", "nazov", "mj"],
  volitelne: ["poznamka"],
} as const;

describe("parseCsv — formát a oddeľovače", () => {
  test("bodkočiarkový súbor s BOM a CRLF", () => {
    const text = "﻿kod;nazov;mj;poznamka\r\nSBR-1502;Kaučuk SBR 1502;kg;balenie 25 kg\r\nN330;Sadze N330;kg;\r\n";
    const { riadky, chyby } = parseCsv(text, STLPCE);

    expect(chyby).toEqual([]);
    expect(riadky).toHaveLength(2);
    expect(riadky[0]).toEqual({
      cislo: 2,
      polia: {
        kod: "SBR-1502",
        nazov: "Kaučuk SBR 1502",
        mj: "kg",
        poznamka: "balenie 25 kg",
      },
    });
    expect(riadky[1].cislo).toBe(3);
    expect(riadky[1].polia.poznamka).toBe("");
  });

  test("čiarkový súbor s quoted poľom obsahujúcim čiarku aj úvodzovky", () => {
    const text = 'kod,nazov,mj,poznamka\nA1,"Zmäkčovadlo, tzv. ""TDAE""",kg,\n';
    const { riadky, chyby } = parseCsv(text, STLPCE);

    expect(chyby).toEqual([]);
    expect(riadky[0].polia.nazov).toBe('Zmäkčovadlo, tzv. "TDAE"');
  });

  test("desatinná čiarka v bodkočiarkovom súbore ostáva v hodnote", () => {
    const text = "kod;nazov;mj\nA1;Síra;kg\nA2;Olej 12,5;l\n";
    const { riadky, chyby } = parseCsv(text, STLPCE);

    expect(chyby).toEqual([]);
    expect(riadky[1].polia.nazov).toBe("Olej 12,5");
  });

  test("quoted pole s novým riadkom vnútri — číslo ďalšieho záznamu sedí", () => {
    const text = 'kod;nazov;mj\nA1;"Prvý\ndruhý riadok";kg\nA2;Sadze;kg\n';
    const { riadky, chyby } = parseCsv(text, STLPCE);

    expect(chyby).toEqual([]);
    expect(riadky[0].polia.nazov).toBe("Prvý\ndruhý riadok");
    expect(riadky[1].cislo).toBe(4); // A2 fyzicky začína na 4. riadku súboru
  });

  test("hodnoty sa trimujú, prázdne riadky sa preskakujú", () => {
    const text = "kod;nazov;mj\n  A1  ;  Síra  ;kg\n;;\n\nA2;Sadze;kg\n";
    const { riadky, chyby } = parseCsv(text, STLPCE);

    expect(chyby).toEqual([]);
    expect(riadky).toHaveLength(2);
    expect(riadky[0].polia.kod).toBe("A1");
    expect(riadky[0].polia.nazov).toBe("Síra");
    expect(riadky[1].cislo).toBe(5);
  });
});

describe("parseCsv — hlavičky", () => {
  test("hlavičky tolerujú veľké písmená a diakritiku", () => {
    const text = "Kód;NÁZOV;Mj;Poznámka\nA1;Síra;kg;x\n";
    const { riadky, chyby } = parseCsv(text, STLPCE);

    expect(chyby).toEqual([]);
    expect(riadky[0].polia).toEqual({
      kod: "A1",
      nazov: "Síra",
      mj: "kg",
      poznamka: "x",
    });
  });

  test("chýbajúci povinný stĺpec → slovenská chyba s názvom stĺpca", () => {
    const { riadky, chyby } = parseCsv("kod;nazov\nA1;Síra\n", STLPCE);

    expect(riadky).toEqual([]);
    expect(chyby).toHaveLength(1);
    expect(chyby[0].riadok).toBe(1);
    expect(chyby[0].sprava).toContain("mj");
  });

  test("neznámy stĺpec → chyba s očakávanými stĺpcami", () => {
    const { chyby } = parseCsv("kod;nazov;mj;cena\nA1;Síra;kg;5\n", STLPCE);

    expect(chyby).toHaveLength(1);
    expect(chyby[0].sprava).toContain("cena");
    expect(chyby[0].sprava).toContain("poznamka");
  });

  test("duplicitný stĺpec → chyba", () => {
    const { chyby } = parseCsv("kod;nazov;mj;kod\nA1;Síra;kg;A1\n", STLPCE);

    expect(chyby).toHaveLength(1);
    expect(chyby[0].sprava).toContain("kod");
  });
});

describe("parseCsv — dátové riadky", () => {
  test("riadok s priveľa poľami → chyba s číslom riadku", () => {
    const { riadky, chyby } = parseCsv(
      "kod;nazov;mj\nA1;Síra;kg;navyše\nA2;Sadze;kg\n",
      STLPCE,
    );

    expect(chyby).toHaveLength(1);
    expect(chyby[0].riadok).toBe(2);
    expect(riadky).toHaveLength(1); // dobrý riadok prežije
    expect(riadky[0].polia.kod).toBe("A2");
  });

  test("riadok s menej poľami sa doplní prázdnymi hodnotami", () => {
    const { riadky, chyby } = parseCsv("kod;nazov;mj\nA1;Síra\n", STLPCE);

    expect(chyby).toEqual([]);
    expect(riadky[0].polia.mj).toBe("");
  });

  test("súbor bez dátových riadkov → chyba", () => {
    const { chyby } = parseCsv("kod;nazov;mj\n", STLPCE);

    expect(chyby).toHaveLength(1);
    expect(chyby[0].sprava).toMatch(/dátov/i);
  });

  test("prázdny súbor → chyba", () => {
    const { chyby } = parseCsv("", STLPCE);

    expect(chyby).toHaveLength(1);
  });

  test("limit 2000 dátových riadkov → chyba", () => {
    const riadky = Array.from({ length: 2001 }, (_, i) => `K${i};Názov;kg`);
    const { chyby } = parseCsv(`kod;nazov;mj\n${riadky.join("\n")}\n`, STLPCE);

    expect(chyby).toHaveLength(1);
    expect(chyby[0].sprava).toContain("2000");
  });

  test("neuzavreté úvodzovky → chyba, nie nekonečný záznam", () => {
    const { chyby } = parseCsv('kod;nazov;mj\nA1;"Síra;kg\n', STLPCE);

    expect(chyby.length).toBeGreaterThan(0);
  });
});

describe("parseCsv — edge-cases z review", () => {
  test("prázdny prvý riadok pred hlavičkou sa preskočí", () => {
    const { riadky, chyby } = parseCsv("\nkod;nazov;mj\nA1;Síra;kg\n", STLPCE);

    expect(chyby).toEqual([]);
    expect(riadky).toHaveLength(1);
    expect(riadky[0].polia.kod).toBe("A1");
    expect(riadky[0].cislo).toBe(3);
  });

  test('súbor obsahujúci len "" nespadne — hlási prázdny súbor', () => {
    const { riadky, chyby } = parseCsv('""', STLPCE);

    expect(riadky).toEqual([]);
    expect(chyby).toHaveLength(1);
    expect(chyby[0].sprava).toMatch(/prázdny|dátov/i);
  });

  test("viac prázdnych stĺpcov na konci hlavičky nie je duplicita", () => {
    const { riadky, chyby } = parseCsv(
      "kod;nazov;mj;;\nA1;Síra;kg;;\n",
      STLPCE,
    );

    expect(chyby).toEqual([]);
    expect(riadky[0].polia.kod).toBe("A1");
  });

  test("CR-only konce riadkov (starý Mac export) fungujú", () => {
    const { riadky, chyby } = parseCsv("kod;nazov;mj\rA1;Síra;kg\rA2;Sadze;kg", STLPCE);

    expect(chyby).toEqual([]);
    expect(riadky).toHaveLength(2);
    expect(riadky[1].polia.kod).toBe("A2");
    expect(riadky[1].cislo).toBe(3);
  });
});
