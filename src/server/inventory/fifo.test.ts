// Čistá FIFO alokácia (D1): loty v poradí príjmu, každý riadok spotreby
// nesie cenu svojho lotu. Záväzné FIFO poradie zo schváleného návrhu:
// (receipts.received_at, receipts.receipt_number, material_lots.line_no).
import { describe, expect, test } from "vitest";
import { alokujFifo, NedostatokZasobyError, porovnajFifo, type FifoLot } from "./fifo";

function lot(overrides: Partial<FifoLot> & { id: string }): FifoLot {
  return {
    receivedAt: "2026-07-01",
    receiptNumber: "P-001",
    lineNo: 1,
    qtyRemaining: "1000.000",
    unitPrice: "45.3500",
    ...overrides,
  };
}

describe("porovnajFifo (záväzný FIFO kľúč)", () => {
  test("starší received_at je prvý", () => {
    const a = lot({ id: "a", receivedAt: "2026-07-01" });
    const b = lot({ id: "b", receivedAt: "2026-07-02" });
    expect(porovnajFifo(a, b)).toBeLessThan(0);
    expect(porovnajFifo(b, a)).toBeGreaterThan(0);
  });

  test("rovnaký deň → rozhoduje receipt_number", () => {
    const a = lot({ id: "a", receiptNumber: "P-001" });
    const b = lot({ id: "b", receiptNumber: "P-002" });
    expect(porovnajFifo(a, b)).toBeLessThan(0);
  });

  test("rovnaká príjemka → rozhoduje line_no", () => {
    const a = lot({ id: "a", lineNo: 1 });
    const b = lot({ id: "b", lineNo: 2 });
    expect(porovnajFifo(a, b)).toBeLessThan(0);
  });
});

describe("alokujFifo", () => {
  test("presný fit z jedného lotu (celý zostatok)", () => {
    const loty = [lot({ id: "a", qtyRemaining: "500.000" })];
    expect(alokujFifo(loty, "500.000")).toEqual([
      { lotId: "a", qty: "500.000", unitPrice: "45.3500" },
    ]);
  });

  test("čiastočný výdaj z jedného lotu", () => {
    const loty = [lot({ id: "a", qtyRemaining: "500.000" })];
    expect(alokujFifo(loty, "120.500")).toEqual([
      { lotId: "a", qty: "120.500", unitPrice: "45.3500" },
    ]);
  });

  test("spill cez viac lotov — každý riadok s cenou SVOJHO lotu", () => {
    const loty = [
      lot({ id: "a", receivedAt: "2026-07-01", qtyRemaining: "200.000", unitPrice: "40.0000" }),
      lot({ id: "b", receivedAt: "2026-07-02", qtyRemaining: "300.000", unitPrice: "45.0000" }),
      lot({ id: "c", receivedAt: "2026-07-03", qtyRemaining: "300.000", unitPrice: "50.0000" }),
    ];
    expect(alokujFifo(loty, "450.000")).toEqual([
      { lotId: "a", qty: "200.000", unitPrice: "40.0000" },
      { lotId: "b", qty: "250.000", unitPrice: "45.0000" },
    ]);
  });

  test("vyčerpané loty preskakuje", () => {
    const loty = [
      lot({ id: "a", receivedAt: "2026-07-01", qtyRemaining: "0.000" }),
      lot({ id: "b", receivedAt: "2026-07-02", qtyRemaining: "100.000" }),
    ];
    expect(alokujFifo(loty, "50.000")).toEqual([
      { lotId: "b", qty: "50.000", unitPrice: "45.3500" },
    ]);
  });

  test("neusporiadaný vstup si zoradí sám podľa FIFO kľúča", () => {
    const loty = [
      lot({ id: "novsi", receivedAt: "2026-07-05", qtyRemaining: "100.000", unitPrice: "50.0000" }),
      lot({ id: "starsi", receivedAt: "2026-07-01", qtyRemaining: "100.000", unitPrice: "40.0000" }),
    ];
    const alokacia = alokujFifo(loty, "150.000");
    expect(alokacia.map((r) => r.lotId)).toEqual(["starsi", "novsi"]);
    expect(alokacia[0].qty).toBe("100.000");
    expect(alokacia[1].qty).toBe("50.000");
  });

  test("presnosť na gram (0,001 kg)", () => {
    const loty = [lot({ id: "a", qtyRemaining: "0.002" })];
    expect(alokujFifo(loty, "0.001")).toEqual([
      { lotId: "a", qty: "0.001", unitPrice: "45.3500" },
    ]);
  });

  test("nedostatok → NedostatokZasobyError s detailom koľko chýba", () => {
    const loty = [
      lot({ id: "a", qtyRemaining: "100.000" }),
      lot({ id: "b", qtyRemaining: "50.500" }),
    ];
    try {
      alokujFifo(loty, "200.000");
      expect.unreachable("malo hodiť NedostatokZasobyError");
    } catch (e) {
      expect(e).toBeInstanceOf(NedostatokZasobyError);
      const err = e as NedostatokZasobyError;
      expect(err.pozadovane).toBe("200.000");
      expect(err.dostupne).toBe("150.500");
      expect(err.chyba).toBe("49.500");
      expect(err.message).toContain("49.500"); // slovenská správa pre UI
    }
  });

  test("požadované množstvo musí byť kladné", () => {
    const loty = [lot({ id: "a" })];
    expect(() => alokujFifo(loty, "0")).toThrow();
    expect(() => alokujFifo(loty, "-5")).toThrow();
  });
});
