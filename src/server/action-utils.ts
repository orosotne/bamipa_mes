// Zdieľané sync helpery pre server actions a služby. Samostatný modul bez
// "use server" — direktíva dovoľuje exportovať len async funkcie.
import { z } from "zod";
import { formatQty, parseQty } from "@/server/inventory/money";

export type VysledokAkcie =
  | { ok: true; id?: string }
  | { ok: false; error: string };

export function naVysledok(e: unknown): VysledokAkcie {
  if (e instanceof z.ZodError) {
    return { ok: false, error: e.issues[0]?.message ?? "Neplatné údaje." };
  }
  if (e instanceof Error) {
    // DrizzleQueryError balí PG chybu do cause s vlastnou hláškou
    // "Failed query: …" — používateľovi patrí doménová hláška z RAISE
    // (DB triggre hovoria po slovensky), nie SQL dump.
    let aktualna: unknown = e;
    while (aktualna instanceof Error) {
      if (!aktualna.message.startsWith("Failed query")) {
        return { ok: false, error: aktualna.message };
      }
      aktualna = aktualna.cause;
    }
    return { ok: false, error: e.message };
  }
  return { ok: false, error: "Neznáma chyba." };
}

/** "1 234,5" → "1234.500" (numeric(12,3) string); kladné. */
export function normalizujQty(input: string, label = "Množstvo"): string {
  const milli = parseQty(input.replace(/[\s  ]/g, "").replace(",", "."));
  if (milli <= 0n) {
    throw new Error(`${label} musí byť kladné.`);
  }
  return formatQty(milli);
}

// SQLSTATE kód môže byť na chybe alebo v cause reťazci (DrizzleQueryError).
export function sqlState(e: unknown): string | undefined {
  let current = e as { code?: string; cause?: unknown } | undefined;
  while (current) {
    if (typeof current.code === "string") return current.code;
    current = current.cause as { code?: string; cause?: unknown } | undefined;
  }
  return undefined;
}
