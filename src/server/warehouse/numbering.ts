// Číslovanie príjemok: P-RRRR-NNNN, poradové per rok (max+1).
// Race pri súbehu zachytí partial unique index na receipt_number —
// volajúci (server action) číslo vygeneruje znova a zopakuje zápis.
import { sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

export async function generujCisloPrijemky(
  db: DbClient,
  rok: number,
): Promise<string> {
  // \d{4,} + numerický max: nad 9999 pokračuje 5-ciferne (P-RRRR-10000, …)
  const vzor = `^P-${rok}-\\d{4,}$`;
  const [riadok] = await db
    .select({
      max: sql<number | null>`max((substring(${schema.receipts.receiptNumber} from 8))::int)`,
    })
    .from(schema.receipts)
    .where(sql`${schema.receipts.receiptNumber} ~ ${vzor}`);

  const dalsie = (riadok?.max ?? 0) + 1;
  return `P-${rok}-${String(dalsie).padStart(4, "0")}`;
}
