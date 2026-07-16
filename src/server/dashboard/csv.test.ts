// CSV export pre účtovníčku (M8): UTF-8 BOM + bodkočiarka + CRLF + desatinná
// čiarka — Excel sk-SK otvorí súbor dvojklikom bez importného sprievodcu.
import { describe, expect, test } from "vitest";
import { cenaCsv, ciarka, csvSubor, eurCsv, eurCsv2 } from "./csv";

// BOM sa overuje VÝHRADNE cez charCodeAt a obsah cez slice(1) — literálny
// BOM znak v očakávaniach je neviditeľný a jeho tichú stratu by test
// nechytil (reálny nález z E2E: BOM sa stratil a testy ostali zelené).
describe("csvSubor", () => {
  test("BOM, bodkočiarky, CRLF a hlavička", () => {
    const csv = csvSubor(["Číslo", "Suma"], [["F-1", "10,00"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("Číslo;Suma\r\nF-1;10,00\r\n");
  });

  test("hodnoty s bodkočiarkou, úvodzovkami a novým riadkom sa escapujú", () => {
    const csv = csvSubor(["a"], [['Dodávateľ; "ACME"\nline2']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('a\r\n"Dodávateľ; ""ACME""\nline2"\r\n');
  });

  test("null a undefined sú prázdne bunky, čísla sa vypíšu", () => {
    const csv = csvSubor(["a", "b", "c"], [[null, undefined, 42]]);
    expect(csv.slice(1)).toBe("a;b;c\r\n;;42\r\n");
  });

  // CSV formula injection (CWE-1236): Excel vyhodnotí bunku začínajúcu na
  // =, +, -, @ alebo TAB ako vzorec/DDE — texty z voľných polí (číslo
  // faktúry, názvy) treba neutralizovať apostrofom. Quoting NESTAČÍ.
  test("bunky začínajúce =, +, @, TAB sa neutralizujú apostrofom", () => {
    const csv = csvSubor(
      ["a"],
      [["=HYPERLINK(\"http://x\";\"y\")"], ["+1+1"], ["@SUM(A1)"], ["\tcmd"]],
    );
    expect(csv.slice(1)).toBe(
      "a\r\n\"'=HYPERLINK(\"\"http://x\"\";\"\"y\"\")\"\r\n'+1+1\r\n'@SUM(A1)\r\n\"'\tcmd\"\r\n",
    );
  });

  test("záporné a kladné ČÍSLA (výstup eurCsv/ciarka) sa nemenia", () => {
    const csv = csvSubor(["a"], [["-9,70"], ["-42"], ["+5,00"], ["-0,4643"]]);
    expect(csv.slice(1)).toBe("a\r\n-9,70\r\n-42\r\n+5,00\r\n-0,4643\r\n");
  });

  test("záporný TEXT (nie číslo) sa neutralizuje", () => {
    const csv = csvSubor(["a"], [["-2+3+cmd"], ["=1+1"]]);
    expect(csv.slice(1)).toBe("a\r\n'-2+3+cmd\r\n'=1+1\r\n");
  });
});

describe("eurCsv", () => {
  test("centy → eurá s desatinnou čiarkou, bez tisícových medzier", () => {
    expect(eurCsv(123456)).toBe("1234,56");
    expect(eurCsv(5)).toBe("0,05");
    expect(eurCsv(0)).toBe("0,00");
    expect(eurCsv(-970)).toBe("-9,70");
  });
});

describe("eurCsv2", () => {
  test("centy s 2 des. → eurá s dokladovou presnosťou", () => {
    expect(eurCsv2("480.65")).toBe("4,8065");
    expect(eurCsv2("46.43")).toBe("0,4643");
    expect(eurCsv2("68501")).toBe("685,01");
    expect(eurCsv2("-16.67")).toBe("-0,1667");
    expect(eurCsv2(null)).toBe("");
  });
});

describe("cenaCsv", () => {
  test("jednotková cena (centy, 4 des.) → €/MJ s orezanými nulami", () => {
    expect(cenaCsv("45.3500")).toBe("0,4535");
    expect(cenaCsv("60.0000")).toBe("0,60");
    expect(cenaCsv("637.5000")).toBe("6,375");
    expect(cenaCsv("100.0000")).toBe("1,00");
  });
});

describe("ciarka", () => {
  test("DB numeric string → desatinná čiarka", () => {
    expect(ciarka("480.65")).toBe("480,65");
    expect(ciarka("160.000")).toBe("160,000");
    expect(ciarka("-16.67")).toBe("-16,67");
    expect(ciarka("42")).toBe("42");
  });
});
