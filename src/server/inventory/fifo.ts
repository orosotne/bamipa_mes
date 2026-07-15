// Čistá FIFO alokácia (D1). Záväzné FIFO poradie zo schváleného návrhu:
// (receipts.received_at, receipts.receipt_number, material_lots.line_no).
// Vstupy/výstupy sú DB numeric stringy — aritmetika cez money.ts (bez floatov).
import { formatQty, parseQty } from "./money";

export type FifoLot = {
  id: string;
  /** receipts.received_at ("YYYY-MM-DD") — 1. úroveň FIFO kľúča */
  receivedAt: string;
  /** receipts.receipt_number — 2. úroveň */
  receiptNumber: string;
  /** material_lots.line_no — 3. úroveň (deterministický tiebreak) */
  lineNo: number;
  /** numeric(12,3) string */
  qtyRemaining: string;
  /** numeric(14,4) string — cena lotu (snapshot do pohybu) */
  unitPrice: string;
};

export type FifoAlokacia = {
  lotId: string;
  /** koľko sa čerpá z lotu (numeric(12,3) string, kladné) */
  qty: string;
  /** cena lotu — snapshot pre vydaj pohyb */
  unitPrice: string;
};

export class NedostatokZasobyError extends Error {
  readonly pozadovane: string;
  readonly dostupne: string;
  readonly chyba: string;

  constructor(pozadovaneMilli: bigint, dostupneMilli: bigint) {
    const chybaMilli = pozadovaneMilli - dostupneMilli;
    const pozadovane = formatQty(pozadovaneMilli);
    const dostupne = formatQty(dostupneMilli);
    const chyba = formatQty(chybaMilli);
    super(
      `Nedostatok zásoby: požadované ${pozadovane} kg, dostupné ${dostupne} kg — chýba ${chyba} kg.`,
    );
    this.name = "NedostatokZasobyError";
    this.pozadovane = pozadovane;
    this.dostupne = dostupne;
    this.chyba = chyba;
  }
}

/** Záväzný FIFO komparátor: received_at, receipt_number, line_no. */
export function porovnajFifo(a: FifoLot, b: FifoLot): number {
  if (a.receivedAt !== b.receivedAt) {
    return a.receivedAt < b.receivedAt ? -1 : 1;
  }
  if (a.receiptNumber !== b.receiptNumber) {
    return a.receiptNumber < b.receiptNumber ? -1 : 1;
  }
  return a.lineNo - b.lineNo;
}

/**
 * Alokuje požadované množstvo cez loty vo FIFO poradí.
 * Vyhodí NedostatokZasobyError, ak zostatky nestačia (žiadna čiastočná alokácia).
 */
export function alokujFifo(
  loty: ReadonlyArray<FifoLot>,
  pozadovane: string,
): FifoAlokacia[] {
  const pozadovaneMilli = parseQty(pozadovane);
  if (pozadovaneMilli <= 0n) {
    throw new Error(
      `Požadované množstvo musí byť kladné (dostal: „${pozadovane}").`,
    );
  }

  const zoradene = [...loty].sort(porovnajFifo);

  const dostupneMilli = zoradene.reduce(
    (sum, l) => sum + parseQty(l.qtyRemaining),
    0n,
  );
  if (dostupneMilli < pozadovaneMilli) {
    throw new NedostatokZasobyError(pozadovaneMilli, dostupneMilli);
  }

  const alokacia: FifoAlokacia[] = [];
  let zostava = pozadovaneMilli;
  for (const l of zoradene) {
    if (zostava === 0n) break;
    const zostatokLotu = parseQty(l.qtyRemaining);
    if (zostatokLotu <= 0n) continue;
    const zoberiem = zostatokLotu < zostava ? zostatokLotu : zostava;
    alokacia.push({
      lotId: l.id,
      qty: formatQty(zoberiem),
      unitPrice: l.unitPrice,
    });
    zostava -= zoberiem;
  }
  return alokacia;
}
