// Výdaj navážky (M4) — záväzný transakčný FIFO protokol zo schváleného návrhu:
// v JEDNEJ transakcii SELECT kandidátnych lotov vo FIFO poradí FOR UPDATE →
// čistá alokácia → INSERT vydaj pohybov. Zostatky updatuje DB trigger
// (apply_stock_move); prečerpanie zachytí CHECK (qty_remaining >= 0).
// Retry na 23514 (check violation) / 40001 (serialization) — súbeh tabletov.
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { sqlState } from "@/server/action-utils";
import { alokujFifo } from "./fifo";
import { nacitajFifoKandidatov } from "./lots";

export type VstupVydaja = {
  userId: string;
  batchId: string;
  materialId: string;
  /** požadované množstvo, numeric(12,3) string, kladné */
  qty: string;
  /** rework: výdaj v rámci úpravy dávky po zamietnutí labákom */
  adjustmentId?: string;
  note?: string;
};

export type VysledokVydaja = {
  pohyby: (typeof schema.stockMoves.$inferSelect)[];
};

const RETRYABLE_SQLSTATE = new Set(["23514", "40001"]);
const MAX_POKUSY = 3;

async function vydajRaz(
  db: DbClient,
  vstup: VstupVydaja,
): Promise<VysledokVydaja> {
  return db.transaction(async (tx) => {
    // Kandidátne loty vo FIFO poradí, zamknuté proti súbehu (lots.ts).
    const kandidati = await nacitajFifoKandidatov(tx, vstup.materialId);

    // Čistá FIFO alokácia — pri nedostatku hodí NedostatokZasobyError
    // a transakcia sa vráti bez jediného pohybu.
    const alokacia = alokujFifo(kandidati, vstup.qty);

    const pohyby: (typeof schema.stockMoves.$inferSelect)[] = [];
    for (const riadok of alokacia) {
      const [pohyb] = await tx
        .insert(schema.stockMoves)
        .values({
          lotId: riadok.lotId,
          moveType: "vydaj",
          qtyDelta: `-${riadok.qty}`,
          batchId: vstup.batchId,
          adjustmentId: vstup.adjustmentId ?? null,
          unitPrice: riadok.unitPrice,
          note: vstup.note,
          createdBy: vstup.userId,
        })
        .returning();
      pohyby.push(pohyb);
    }

    return { pohyby };
  });
}

/** Výdaj materiálu na dávku vo FIFO poradí (multi-lot, ceny per šarža). */
export async function vydajNavazky(
  db: DbClient,
  vstup: VstupVydaja,
): Promise<VysledokVydaja> {
  let poslednaChyba: unknown;
  for (let pokus = 1; pokus <= MAX_POKUSY; pokus++) {
    try {
      return await vydajRaz(db, vstup);
    } catch (e) {
      if (!RETRYABLE_SQLSTATE.has(sqlState(e) ?? "")) {
        throw e;
      }
      poslednaChyba = e;
    }
  }
  throw poslednaChyba;
}
