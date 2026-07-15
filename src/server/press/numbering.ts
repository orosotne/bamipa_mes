// Číslovanie dokladov lisovne: výrobný príkaz PR-RRRR-NNNN, dodací list
// DL-RRRR-NNNN, poradové per rok (max+1). Race pri súbehu zachytí partial
// unique index — volajúci číslo vygeneruje znova a zopakuje zápis (23505).
// Čísla sa nerecyklujú, preto max ide aj cez soft-deletnuté doklady.
import { sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

// Prefix „PR-RRRR-" aj „DL-RRRR-" má 8 znakov → poradové číslo od pozície 9.
export async function generujCisloPrikazu(
  db: DbClient,
  rok: number,
): Promise<string> {
  // \d{4,} + numerický max: nad 9999 pokračuje 5-ciferne (PR-RRRR-10000, …)
  const vzor = `^PR-${rok}-\\d{4,}$`;
  const [riadok] = await db
    .select({
      max: sql<
        number | null
      >`max((substring(${schema.workOrders.orderNumber} from 9))::int)`,
    })
    .from(schema.workOrders)
    .where(sql`${schema.workOrders.orderNumber} ~ ${vzor}`);

  const dalsie = (riadok?.max ?? 0) + 1;
  return `PR-${rok}-${String(dalsie).padStart(4, "0")}`;
}

export async function generujCisloDodacieho(
  db: DbClient,
  rok: number,
): Promise<string> {
  const vzor = `^DL-${rok}-\\d{4,}$`;
  const [riadok] = await db
    .select({
      max: sql<
        number | null
      >`max((substring(${schema.shipments.shipmentNumber} from 9))::int)`,
    })
    .from(schema.shipments)
    .where(sql`${schema.shipments.shipmentNumber} ~ ${vzor}`);

  const dalsie = (riadok?.max ?? 0) + 1;
  return `DL-${rok}-${String(dalsie).padStart(4, "0")}`;
}
