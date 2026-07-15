// Číslovanie výrobných dávok valcovne: V-RRRR-NNNN, poradové per rok (max+1).
// Vzor: warehouse/numbering.ts (P-RRRR-NNNN). Race pri súbehu zachytí partial
// unique index na batch_number — volajúci (server action) číslo vygeneruje
// znova a zopakuje zápis.
import { sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

export async function generujCisloDavky(
  db: DbClient,
  rok: number,
): Promise<string> {
  // \d{4,} + numerický max: nad 9999 pokračuje 5-ciferne (V-RRRR-10000, …)
  // Číslo začína na pozícii 8 ("V-RRRR-" má 7 znakov).
  const vzor = `^V-${rok}-\\d{4,}$`;
  const [riadok] = await db
    .select({
      max: sql<number | null>`max((substring(${schema.productionBatches.batchNumber} from 8))::int)`,
    })
    .from(schema.productionBatches)
    .where(sql`${schema.productionBatches.batchNumber} ~ ${vzor}`);

  const dalsie = (riadok?.max ?? 0) + 1;
  return `V-${rok}-${String(dalsie).padStart(4, "0")}`;
}
