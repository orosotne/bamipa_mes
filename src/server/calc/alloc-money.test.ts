// Alokačná aritmetika M7 (D2/D4) — TDD PRED implementáciou (CLAUDE.md).
// Všetky očakávané hodnoty sú ručne prepočítané (výpočet v komentári),
// zaokrúhlenie half up / away from zero ako Postgres round(numeric).
import { describe, expect, test } from "vitest";
import {
  alokujCykly,
  alokujKg,
  aplikujPct,
  prirazkaPct,
  rozdelEnergiu,
  sadzbaCentovNaCyklus,
  sadzbaCentovNaKg,
} from "./alloc-money";

describe("sadzbaCentovNaKg (valcovňa: pool / kg mesiaca)", () => {
  test("presné delenie: 102 000 c / 160,000 kg = 637,5 c/kg", () => {
    expect(sadzbaCentovNaKg(102000n, 160000n)).toBe("637.500000");
  });

  test("periodické delenie sa reže na 6 des.: 10 000 c / 3,000 kg", () => {
    // 10000×10⁹ / 3000 = 3 333 333 333,33… → 3 333 333 333 → 3333,333333 c/kg
    expect(sadzbaCentovNaKg(10000n, 3000n)).toBe("3333.333333");
  });

  test("malý pool na veľký základ: 1 c / 1 600,000 kg = 0,000625 c/kg", () => {
    expect(sadzbaCentovNaKg(1n, 1600000n)).toBe("0.000625");
  });

  test("záporný pool (dobropisy) → záporná sadzba away from zero", () => {
    expect(sadzbaCentovNaKg(-10000n, 3000n)).toBe("-3333.333333");
  });

  test("nulový základ = chyba (uzávierka validuje skôr, helper je backstop)", () => {
    expect(() => sadzbaCentovNaKg(100n, 0n)).toThrow(/základ/);
  });
});

describe("sadzbaCentovNaCyklus (lisovňa: pool / cykly mesiaca)", () => {
  test("presné delenie: 90 000 c / 200 cyklov = 450 c/cyklus", () => {
    expect(sadzbaCentovNaCyklus(90000n, 200n)).toBe("450.000000");
  });

  test("periodické delenie: 100 c / 3 cykly = 33,333333 c/cyklus", () => {
    // 100×10⁶ / 3 = 33 333 333,33… → 33 333 333
    expect(sadzbaCentovNaCyklus(100n, 3n)).toBe("33.333333");
  });

  test("presná polovica na 6. des. mieste sa zaokrúhľuje HORE (half up)", () => {
    // 1×10⁶ / 2 000 000 = 0,5 → 1 → 0,000001 c/cyklus
    expect(sadzbaCentovNaCyklus(1n, 2000000n)).toBe("0.000001");
  });

  test("nulový základ = chyba", () => {
    expect(() => sadzbaCentovNaCyklus(100n, 0n)).toThrow(/základ/);
  });
});

describe("prirazkaPct (labák/správa: pool / základ v centoch → %)", () => {
  test("okrúhly prípad: 21 000 c / 210 000 c = 10 %", () => {
    expect(prirazkaPct(21000n, 210000n)).toBe("10.000000");
  });

  test("neokrúhly prípad: 840 c / 7 429 c", () => {
    // 840/7429 = 0,1130703997… → 11,30703997… % → half up na 6 des. →
    // 11,307040 % (ručne: 7429 × 11 307 039 = 83 999 992 731;
    // 84 000 000 000 − 83 999 992 731 = 7 269 → 7269/7429 ≈ 0,98 → hore).
    expect(prirazkaPct(840n, 7429n)).toBe("11.307040");
  });

  test("nulový základ = chyba", () => {
    expect(() => prirazkaPct(840n, 0n)).toThrow(/základ/);
  });
});

describe("alokujKg (kg dávky × sadzba c/kg → centy, zaokrúhlené RAZ)", () => {
  test("presná alokácia: 100,000 kg × 637,500000 = 63 750 c", () => {
    expect(alokujKg(100000n, "637.500000")).toBe(63750n);
  });

  test("zaokrúhlenie raz na konci: 0,333 kg × 45,350000 c/kg", () => {
    // 0,333 × 45,35 = 15,10155 c → 15 c
    expect(alokujKg(333n, "45.350000")).toBe(15n);
  });

  test("záporná sadzba (záporný pool): away from zero", () => {
    // 3,000 kg × −3333,333333 = −9 999,999999 → −10 000 c
    expect(alokujKg(3000n, "-3333.333333")).toBe(-10000n);
  });
});

describe("alokujCykly (cykly × sadzba c/cyklus → centy)", () => {
  test("presná alokácia: 120 × 450 = 54 000 c", () => {
    expect(alokujCykly(120n, "450.000000")).toBe(54000n);
  });

  test("zaokrúhlenie raz: 7 × 33,333333 = 233,333331 → 233 c", () => {
    expect(alokujCykly(7n, "33.333333")).toBe(233n);
  });
});

describe("aplikujPct (prirážka % zo sumy → centy)", () => {
  test("11,307040 % z 4 268 c = 483 c", () => {
    // 4268 × 0,11307040 = 482,5844672 → 483 c
    expect(aplikujPct(4268n, "11.307040")).toBe(483n);
  });

  test("10 % z 1 c = 0,1 c → 0 c (pod pol centa)", () => {
    expect(aplikujPct(1n, "10.000000")).toBe(0n);
  });

  test("z nuly je nula", () => {
    expect(aplikujPct(0n, "11.307040")).toBe(0n);
  });
});

describe("rozdelEnergiu (D4: fixný pomer, bezo zvyšku)", () => {
  test("60/40 zo 100 000 c", () => {
    expect(rozdelEnergiu(100000n, 60)).toEqual({
      valcovna: 60000n,
      lisovna: 40000n,
    });
  });

  test("nedeliteľná suma: valcovňa half up, lisovňa dopočet — súčet sedí", () => {
    // 33 333 × 60 % = 19 999,8 → 20 000; lisovňa = 33 333 − 20 000 = 13 333
    expect(rozdelEnergiu(33333n, 60)).toEqual({
      valcovna: 20000n,
      lisovna: 13333n,
    });
  });

  test("1 cent pri 50/50: polovica ide valcovni (half up), zvyšok 0", () => {
    expect(rozdelEnergiu(1n, 50)).toEqual({ valcovna: 1n, lisovna: 0n });
  });

  test("záporná suma (dobropis energie): away from zero, súčet sedí", () => {
    expect(rozdelEnergiu(-33333n, 60)).toEqual({
      valcovna: -20000n,
      lisovna: -13333n,
    });
  });

  test("krajné pomery 0 a 100", () => {
    expect(rozdelEnergiu(500n, 0)).toEqual({ valcovna: 0n, lisovna: 500n });
    expect(rozdelEnergiu(500n, 100)).toEqual({ valcovna: 500n, lisovna: 0n });
  });

  test("neplatný pomer = chyba", () => {
    expect(() => rozdelEnergiu(100n, 101)).toThrow(/pomer/i);
    expect(() => rozdelEnergiu(100n, -1)).toThrow(/pomer/i);
    expect(() => rozdelEnergiu(100n, 60.5)).toThrow(/pomer/i);
  });
});
