// Klient-safe formátovanie pre UI: EUR ↔ centy a sk-SK dátumy.
// Ručná implementácia (nie Intl) → deterministické testy nezávislé od ICU.
// NBSP = nezlomiteľná medzera ( ) — typograficky správne skupiny tisícov.
import { describe, expect, test } from "vitest";
import {
  formatCentsToEur,
  formatDatum,
  formatPriceToEurPerUnit,
  parseEurPerUnitToPrice,
  parseEurToCents,
  zobrazQty,
} from "./format";

const NBSP = " ";

describe("parseEurToCents (vstup z formulára → centy integer)", () => {
  test("slovenský zápis s medzerami a čiarkou", () => {
    expect(parseEurToCents("1 234,56")).toBe(123_456);
  });

  test("bodka ako desatinný oddeľovač (copy-paste z Excelu)", () => {
    expect(parseEurToCents("1234.56")).toBe(123_456);
  });

  test("celé eurá bez desatinných", () => {
    expect(parseEurToCents("150")).toBe(15_000);
  });

  test("jedno desatinné miesto", () => {
    expect(parseEurToCents("0,5")).toBe(50);
  });

  test("orezáva okraje a akceptuje NBSP (copy-paste)", () => {
    expect(parseEurToCents(" 1 234,56 ")).toBe(123_456);
    expect(parseEurToCents(`1${NBSP}234,56`)).toBe(123_456);
  });

  test("záporná suma (dobropis platby)", () => {
    expect(parseEurToCents("-12,30")).toBe(-1_230);
  });

  test("viac ako 2 desatinné miesta → chyba", () => {
    expect(() => parseEurToCents("12,345")).toThrow();
  });

  test("nečíselný vstup → chyba so slovenskou hláškou", () => {
    expect(() => parseEurToCents("abc")).toThrow(/suma/i);
    expect(() => parseEurToCents("")).toThrow();
  });
});

describe("formatCentsToEur (centy → sk-SK zobrazenie s NBSP)", () => {
  test("tisíce s NBSP, čiarka, € s NBSP", () => {
    expect(formatCentsToEur(123_456)).toBe(`1${NBSP}234,56${NBSP}€`);
  });

  test("pod jedno euro", () => {
    expect(formatCentsToEur(50)).toBe(`0,50${NBSP}€`);
  });

  test("nula", () => {
    expect(formatCentsToEur(0)).toBe(`0,00${NBSP}€`);
  });

  test("záporná suma", () => {
    expect(formatCentsToEur(-1_230)).toBe(`-12,30${NBSP}€`);
  });

  test("milióny (viac skupín)", () => {
    expect(formatCentsToEur(100_000_000)).toBe(`1${NBSP}000${NBSP}000,00${NBSP}€`);
  });
});

describe("parseEurPerUnitToPrice (vstup €/MJ → DB numeric(14,4) centy string)", () => {
  test("4 desatinné miesta: 1,2345 €/kg → 123.4500 c", () => {
    expect(parseEurPerUnitToPrice("1,2345")).toBe("123.4500");
  });

  test("cenníková cena sadzí: 0,4535 €/kg → 45.3500 c", () => {
    expect(parseEurPerUnitToPrice("0,4535")).toBe("45.3500");
  });

  test("celé eurá: 40 → 4000.0000 c", () => {
    expect(parseEurPerUnitToPrice("40")).toBe("4000.0000");
  });

  test("bodka aj čiarka fungujú", () => {
    expect(parseEurPerUnitToPrice("1.2345")).toBe("123.4500");
  });

  test("viac ako 4 desatinné miesta → chyba", () => {
    expect(() => parseEurPerUnitToPrice("1,23456")).toThrow();
  });

  test("nečíselný / záporný vstup → chyba (cena šarže je vždy kladná)", () => {
    expect(() => parseEurPerUnitToPrice("abc")).toThrow(/cena/i);
    expect(() => parseEurPerUnitToPrice("-1,20")).toThrow();
    expect(() => parseEurPerUnitToPrice("0")).toThrow();
  });
});

describe("formatPriceToEurPerUnit (DB centy string → €/MJ zobrazenie)", () => {
  test("oreže koncové nuly, min. 2 desatinné miesta", () => {
    expect(formatPriceToEurPerUnit("4000.0000")).toBe(`40,00${NBSP}€`);
  });

  test("plná presnosť keď je potrebná", () => {
    expect(formatPriceToEurPerUnit("45.3500")).toBe(`0,4535${NBSP}€`);
    expect(formatPriceToEurPerUnit("123.4500")).toBe(`1,2345${NBSP}€`);
  });

  test("medzičíslo: 3 platné desatinné miesta", () => {
    expect(formatPriceToEurPerUnit("45.3000")).toBe(`0,453${NBSP}€`);
  });

  test("round-trip", () => {
    expect(formatPriceToEurPerUnit(parseEurPerUnitToPrice("0,4535"))).toBe(
      `0,4535${NBSP}€`,
    );
  });
});

describe("zobrazQty (DB numeric(12,3) string → množstvo bez koncových núl)", () => {
  test("celé číslo: orezané desatinné nuly", () => {
    expect(zobrazQty("500.000")).toBe("500");
  });

  test("desatinné číslo: koncové nuly preč, čiarka namiesto bodky", () => {
    expect(zobrazQty("500.500")).toBe("500,5");
  });

  test("plná presnosť na 3 desatinné miesta", () => {
    expect(zobrazQty("12.345")).toBe("12,345");
  });

  test("hodnota pod jedna", () => {
    expect(zobrazQty("0.500")).toBe("0,5");
  });

  test("nula → „0“ (nie prázdny reťazec)", () => {
    expect(zobrazQty("0.000")).toBe("0");
  });
});

describe("formatDatum (ISO date string → sk-SK)", () => {
  test("bežný dátum", () => {
    expect(formatDatum("2026-07-13")).toBe("13. 7. 2026");
  });

  test("jednociferný deň a mesiac bez núl", () => {
    expect(formatDatum("2026-01-05")).toBe("5. 1. 2026");
  });

  test("neplatný vstup → chyba", () => {
    expect(() => formatDatum("13.7.2026")).toThrow();
  });
});
