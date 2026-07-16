// Alokačná aritmetika M7 (D2/D4) — bigint bez floatov, vzor inventory/money.
// Sadzby na 6 des. miest (c/kg, c/cyklus, prirážka v %); delenie aj násobenie
// zaokrúhľuje half up / away from zero (ako Postgres round(numeric)) a vždy
// RAZ — na výslednej sadzbe, resp. na alokovaných centoch. Ručný prepočet:
// alokácia dokladu = round(základ × uložená sadzba) — SPEC §12.
import { formatScaled, parseScaled } from "@/server/inventory/money";

const RATE_DECIMALS = 6;
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);
/** kg ×10³ (numeric(12,3)) */
const QTY_SCALE = 1000n;
const PCT_SCALE = 100n;

/** n / d, half up / away from zero; d > 0. (Zdieľané aj pre marže.) */
export function delHalfUp(n: bigint, d: bigint): bigint {
  const sign = n < 0n ? -1n : 1n;
  const abs = n < 0n ? -n : n;
  return (sign * (abs * 2n + d)) / (2n * d);
}

function overZaklad(basis: bigint): void {
  if (basis <= 0n) {
    throw new Error(
      "Alokačný základ musí byť kladný — mesiac nemá na čo alokovať réžie.",
    );
  }
}

/** pool (centy) / kg(×10³) → sadzba c/kg na 6 des. (numeric(18,6) string). */
export function sadzbaCentovNaKg(poolCents: bigint, kgMilli: bigint): string {
  overZaklad(kgMilli);
  return formatScaled(
    delHalfUp(poolCents * RATE_SCALE * QTY_SCALE, kgMilli),
    RATE_DECIMALS,
  );
}

/** pool (centy) / cykly → sadzba c/cyklus na 6 des. */
export function sadzbaCentovNaCyklus(
  poolCents: bigint,
  cykly: bigint,
): string {
  overZaklad(cykly);
  return formatScaled(delHalfUp(poolCents * RATE_SCALE, cykly), RATE_DECIMALS);
}

/** pool (centy) / základ (centy) → prirážka v % na 6 des. */
export function prirazkaPct(poolCents: bigint, zakladCents: bigint): string {
  overZaklad(zakladCents);
  return formatScaled(
    delHalfUp(poolCents * PCT_SCALE * RATE_SCALE, zakladCents),
    RATE_DECIMALS,
  );
}

/** kg(×10³) × sadzba c/kg → centy, zaokrúhlené RAZ. */
export function alokujKg(kgMilli: bigint, sadzba: string): bigint {
  const s = parseScaled(sadzba, RATE_DECIMALS, "sadzby");
  return delHalfUp(kgMilli * s, QTY_SCALE * RATE_SCALE);
}

/** cykly × sadzba c/cyklus → centy, zaokrúhlené RAZ. */
export function alokujCykly(cykly: bigint, sadzba: string): bigint {
  const s = parseScaled(sadzba, RATE_DECIMALS, "sadzby");
  return delHalfUp(cykly * s, RATE_SCALE);
}

/** prirážka % zo sumy (centy) → centy, zaokrúhlené RAZ. */
export function aplikujPct(sumaCents: bigint, pct: string): bigint {
  const p = parseScaled(pct, RATE_DECIMALS, "prirážky");
  return delHalfUp(sumaCents * p, PCT_SCALE * RATE_SCALE);
}

/**
 * D4: rozdelenie mesačnej energie fixným pomerom inštalovaného príkonu —
 * valcovňa half up, lisovňa dopočet do celku (delenie bezo zvyšku).
 */
export function rozdelEnergiu(
  totalCents: bigint,
  valcovnaPct: number,
): { valcovna: bigint; lisovna: bigint } {
  if (!Number.isInteger(valcovnaPct) || valcovnaPct < 0 || valcovnaPct > 100) {
    throw new Error("Pomer D4 musí byť celé číslo 0–100 %.");
  }
  const valcovna = delHalfUp(totalCents * BigInt(valcovnaPct), PCT_SCALE);
  return { valcovna, lisovna: totalCents - valcovna };
}
