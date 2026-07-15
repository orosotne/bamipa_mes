// Škálovaná peňažná/množstevná aritmetika — žiadne floaty.
// qty numeric(12,3) → bigint ×10³ ("mili-kg"); cena numeric(14,4) → bigint ×10⁴.
// Politika zaokrúhľovania (schválený návrh): násobky v plnej presnosti,
// zaokrúhliť RAZ na konci agregátu, half up (away from zero — ako Postgres round()).
import { describe, expect, test } from "vitest";
import {
  formatPrice,
  formatQty,
  parsePrice,
  parseQty,
  sumLineCostsCents,
} from "./money";

describe("parseQty (numeric(12,3) string → bigint ×10³)", () => {
  test("parsuje desatinné kg", () => {
    expect(parseQty("12.345")).toBe(12_345n);
  });

  test("parsuje celé kg", () => {
    expect(parseQty("2500")).toBe(2_500_000n);
  });

  test("dopĺňa chýbajúce desatinné miesta", () => {
    expect(parseQty("2500.5")).toBe(2_500_500n);
  });

  test("parsuje záporné množstvo (storná)", () => {
    expect(parseQty("-100.001")).toBe(-100_001n);
  });

  test("odmieta viac ako 3 desatinné miesta", () => {
    expect(() => parseQty("1.2345")).toThrow();
  });

  test("odmieta nečíselný vstup", () => {
    expect(() => parseQty("abc")).toThrow();
  });
});

describe("parsePrice (numeric(14,4) string → bigint ×10⁴)", () => {
  test("parsuje sadzbu so 4 desatinnými miestami", () => {
    expect(parsePrice("45.3500")).toBe(453_500n);
  });

  test("dopĺňa chýbajúce desatinné miesta", () => {
    expect(parsePrice("45.35")).toBe(453_500n);
  });

  test("odmieta viac ako 4 desatinné miesta", () => {
    expect(() => parsePrice("1.23456")).toThrow();
  });
});

describe("formatQty / formatPrice (bigint → DB string, round-trip)", () => {
  test("formatQty", () => {
    expect(formatQty(12_345n)).toBe("12.345");
    expect(formatQty(-100_001n)).toBe("-100.001");
    expect(formatQty(2_500_000n)).toBe("2500.000");
  });

  test("formatPrice", () => {
    expect(formatPrice(453_500n)).toBe("45.3500");
  });

  test("round-trip", () => {
    expect(formatQty(parseQty("0.001"))).toBe("0.001");
    expect(formatPrice(parsePrice("0.0001"))).toBe("0.0001");
  });
});

describe("sumLineCostsCents (Σ qty×cena → centy, zaokrúhlenie RAZ na konci)", () => {
  test("jeden riadok: 12,345 kg × 250,0000 c = 3086,25 → 3086", () => {
    expect(sumLineCostsCents([{ qty: "12.345", price: "250.0000" }])).toBe(
      3_086n,
    );
  });

  test("half up: 12,346 kg × 250,0000 c = 3086,50 → 3087", () => {
    expect(sumLineCostsCents([{ qty: "12.346", price: "250.0000" }])).toBe(
      3_087n,
    );
  });

  test("zaokrúhľuje sa raz na agregát, nie per riadok (2× 0,3 c = 0,6 → 1)", () => {
    const lines = [
      { qty: "0.003", price: "100.0000" },
      { qty: "0.003", price: "100.0000" },
    ];
    expect(sumLineCostsCents(lines)).toBe(1n);
  });

  test("záporný riadok (storno): -3086,50 → -3087 (away from zero ako Postgres)", () => {
    expect(sumLineCostsCents([{ qty: "-12.346", price: "250.0000" }])).toBe(
      -3_087n,
    );
  });

  test("zmiešané riadky: 100×45,35 + (-10×45,35) = 4081,50 → 4082", () => {
    const lines = [
      { qty: "100", price: "45.3500" },
      { qty: "-10", price: "45.3500" },
    ];
    expect(sumLineCostsCents(lines)).toBe(4_082n);
  });

  test("prázdny zoznam → 0", () => {
    expect(sumLineCostsCents([])).toBe(0n);
  });
});
