// Škálovaná aritmetika bez floatov.
// qty numeric(12,3) ↔ bigint ×10³; cena numeric(14,4) ↔ bigint ×10⁴.
// Riadkový náklad qty×cena je v surovej mierke ×10⁷ centov; zaokrúhľuje sa
// RAZ na konci agregátu, half up / away from zero (ako Postgres round(numeric)).

const QTY_DECIMALS = 3;
const PRICE_DECIMALS = 4;
/** qty(×10³) × price(×10⁴) → surové centy ×10⁷ */
const RAW_SCALE = 10n ** BigInt(QTY_DECIMALS + PRICE_DECIMALS);

// Exportované aj pre alokačnú aritmetiku M7 (sadzby ×10⁶ — calc/alloc-money).
export function parseScaled(
  input: string,
  decimals: number,
  label: string,
): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!m) {
    throw new Error(`Neplatná hodnota ${label}: „${input}"`);
  }
  const [, sign, whole, frac = ""] = m;
  if (frac.length > decimals) {
    throw new Error(
      `Hodnota ${label} „${input}" má viac ako ${decimals} desatinné miesta.`,
    );
  }
  const scaled =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(frac.padEnd(decimals, "0") || "0");
  return sign === "-" ? -scaled : scaled;
}

export function formatScaled(value: bigint, decimals: number): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = (abs % divisor).toString().padStart(decimals, "0");
  return `${sign}${whole}.${frac}`;
}

/** "12.345" → 12345n (kg ×10³) */
export function parseQty(input: string): bigint {
  return parseScaled(input, QTY_DECIMALS, "množstva");
}

/** "45.3500" → 453500n (centy ×10⁴) */
export function parsePrice(input: string): bigint {
  return parseScaled(input, PRICE_DECIMALS, "ceny");
}

/** 12345n → "12.345" (DB numeric(12,3) string) */
export function formatQty(value: bigint): string {
  return formatScaled(value, QTY_DECIMALS);
}

/** 453500n → "45.3500" (DB numeric(14,4) string) */
export function formatPrice(value: bigint): string {
  return formatScaled(value, PRICE_DECIMALS);
}

/** Half up / away from zero — zhodné s Postgres round(numeric). */
function rawToCentsHalfUp(raw: bigint): bigint {
  const sign = raw < 0n ? -1n : 1n;
  const abs = raw < 0n ? -raw : raw;
  return (sign * (abs * 2n + RAW_SCALE)) / (2n * RAW_SCALE);
}

/**
 * Σ(qty × cena) cez riadky → centy (bigint).
 * Násobky sa držia v plnej presnosti, zaokrúhľuje sa RAZ na konci agregátu.
 */
export function sumLineCostsCents(
  lines: ReadonlyArray<{ qty: string; price: string }>,
): bigint {
  let raw = 0n;
  for (const line of lines) {
    raw += parseQty(line.qty) * parsePrice(line.price);
  }
  return rawToCentsHalfUp(raw);
}
