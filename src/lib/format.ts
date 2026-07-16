// Klient-safe formátovanie pre UI (žiadne server-only importy).
// EUR ↔ centy (integer) a sk-SK dátumy. Ručná implementácia namiesto Intl —
// deterministický výstup nezávislý od ICU verzie prostredia.

const NBSP = " ";

/**
 * "1 234,56" → 123456 (centy). Akceptuje čiarku aj bodku ako desatinný
 * oddeľovač a medzery/NBSP ako oddeľovače tisícov. Max 2 desatinné miesta.
 */
export function parseEurToCents(input: string): number {
  const normalized = input
    .replace(/[\s  ]/g, "") // medzery, NBSP, úzka NBSP
    .replace(",", ".");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!m) {
    throw new Error(`Neplatná suma: „${input}" (očakávam napr. 1 234,56).`);
  }
  const [, sign, whole, frac = ""] = m;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`Suma „${input}" je príliš veľká.`);
  }
  return sign === "-" ? -cents : cents;
}

/** 123456 → "1 234,56 €" (NBSP skupiny tisícov aj pred €). */
export function formatCentsToEur(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole},${frac}${NBSP}€`;
}

/**
 * Vstup €/MJ (napr. "1,2345") → DB numeric(14,4) string v CENTOCH ("123.4500").
 * Jednotkové sadzby majú dokladovú presnosť 4 des. miest (schválený návrh);
 * cena šarže je vždy kladná.
 */
export function parseEurPerUnitToPrice(input: string): string {
  const normalized = input.replace(/[\s  ]/g, "").replace(",", ".");
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(normalized);
  if (!m) {
    throw new Error(`Neplatná cena: „${input}" (očakávam napr. 1,2345).`);
  }
  const [, whole, frac = ""] = m;
  // € ×10⁴ (vstupné digity) ×100 = centy ×10⁴ (DB mierka).
  const centsScaled = BigInt(whole + frac.padEnd(4, "0")) * 100n;
  if (centsScaled === 0n) {
    throw new Error("Cena musí byť kladná.");
  }
  const centsWhole = centsScaled / 10_000n;
  const centsFrac = (centsScaled % 10_000n).toString().padStart(4, "0");
  return `${centsWhole}.${centsFrac}`;
}

/**
 * DB numeric(14,4) centy string ("45.3500") → "0,4535 €" (€/MJ).
 * Koncové nuly sa orežú, minimálne 2 desatinné miesta.
 */
export function formatPriceToEurPerUnit(price: string): string {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(price.trim());
  if (!m) {
    throw new Error(`Neplatná DB cena: „${price}".`);
  }
  const [, whole, frac = ""] = m;
  // centy ×10⁴ = € ×10⁶.
  const eurMicro = BigInt(whole + frac.padEnd(4, "0"));
  const eurWhole = (eurMicro / 1_000_000n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  let eurFrac = (eurMicro % 1_000_000n).toString().padStart(6, "0");
  eurFrac = eurFrac.replace(/0+$/, "");
  if (eurFrac.length < 2) {
    eurFrac = eurFrac.padEnd(2, "0");
  }
  return `${eurWhole},${eurFrac}${NBSP}€`;
}

/** "500.000" → "500" / "500.500" → "500,5" (zobrazenie množstva bez koncových núl). */
export function zobrazQty(qty: string): string {
  return qty.replace(/\.?0+$/, "").replace(".", ",") || "0";
}

const MESIACE = [
  "január",
  "február",
  "marec",
  "apríl",
  "máj",
  "jún",
  "júl",
  "august",
  "september",
  "október",
  "november",
  "december",
] as const;

/** "2026-06-01" (period) → "jún 2026" (M7 uzávierky). */
export function formatMesiac(period: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(period);
  if (!m) {
    throw new Error(`Neplatné obdobie: „${period}" (očakávam YYYY-MM…).`);
  }
  return `${MESIACE[Number(m[2]) - 1]} ${m[1]}`;
}

/** "2026-07-13" (ISO/DB date string) → "13. 7. 2026" (sk-SK). */
export function formatDatum(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) {
    throw new Error(`Neplatný dátum: „${isoDate}" (očakávam YYYY-MM-DD).`);
  }
  const [, rok, mesiac, den] = m;
  return `${Number(den)}. ${Number(mesiac)}. ${rok}`;
}
