// Marže per artikel + teoretická vs skutočná kalkulácia (SPEC M7).
// Skutočný náklad = vážený priemer cez DOKONČENÉ príkazy artikla s plne
// uzavretou kalkuláciou (v_work_order_costs.total_cents NOT NULL); marža
// voči sole_models.sale_price_cents. Teoretická zmes na pár = norma kg/pár ×
// materiálová cena aktívneho receptu / štandardná dávka (M3 živá kalkulácia).
// Aritmetika bigint, zaokrúhlenie RAZ na hodnotu (2 des. centy / 3 des. kg).
import { sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import { formatQty, formatScaled, parseQty } from "@/server/inventory/money";
import { teoretickaKalkulacia } from "@/server/inventory/theoretical";
import { delHalfUp } from "./alloc-money";

export type MarzaArtikla = {
  soleModelId: string;
  code: string;
  name: string;
  salePriceCents: number | null;
  /** Ø plný náklad na pár (centy, 2 des.) — null bez uzavretej výroby. */
  costPerPairCents: string | null;
  /** sale − náklad (centy, 2 des.). */
  marginCents: string | null;
  /** marža v % z predajnej ceny (2 des.). */
  marginPct: string | null;
  dobreParov: number;
  /** teoretická zmes na pár podľa receptu (celé centy). */
  teoretickaZmesCents: number | null;
  /** skutočná zmesová zložka na pár (centy, 2 des.). */
  skutocnaZmesCents: string | null;
  normaKgNaPar: string;
  /** skutočná spotreba zmesi na dobrý pár (kg, 3 des.). */
  skutocnaKgNaPar: string | null;
};

function rows<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : (res as { rows: unknown }).rows) as T[];
}

export async function marzeArtiklov(db: DbClient): Promise<MarzaArtikla[]> {
  const artikle = rows<{
    id: string;
    code: string;
    name: string;
    sale_price_cents: number | null;
    mixture_kg_per_pair: string;
    mixture_id: string;
    dobre: string | null;
    total_cents: string | null;
    mixture_cents: string | null;
    mixture_kg: string | null;
  }>(
    await db.execute(sql`
      SELECT sm.id, sm.code, sm.name, sm.sale_price_cents,
             sm.mixture_kg_per_pair::text AS mixture_kg_per_pair,
             sm.mixture_id,
             agg.dobre::text AS dobre,
             agg.total_cents::text AS total_cents,
             agg.mixture_cents::text AS mixture_cents,
             agg.mixture_kg::text AS mixture_kg
        FROM sole_models sm
        LEFT JOIN LATERAL (
          -- Bez filtra pairs_produced > 0: dokončený príkaz so 100 %
          -- nepodarkami má náklad, ktorý MUSÍ ostať v priemere (D5) —
          -- delenie nulou chráni podmienka dobre > 0n nižšie.
          SELECT sum(v.pairs_produced) AS dobre,
                 sum(v.total_cents) AS total_cents,
                 sum(v.mixture_cents) AS mixture_cents,
                 sum(v.mixture_kg) AS mixture_kg
            FROM v_work_order_costs v
           WHERE v.sole_model_id = sm.id
             AND v.status = 'dokoncena'
             AND v.total_cents IS NOT NULL
        ) agg ON true
       WHERE sm.deleted_at IS NULL AND sm.is_active
       ORDER BY sm.code
    `),
  );

  // Teoretická materiálová cena aktívneho receptu per zmes (jeden prepočet
  // pre všetky artikle tej istej zmesi).
  const teoretickaPerZmes = new Map<
    string,
    { materialCents: bigint; batchKgMilli: bigint } | null
  >();
  for (const a of artikle) {
    if (teoretickaPerZmes.has(a.mixture_id)) continue;
    const recepty = rows<{ id: string; standard_batch_kg: string }>(
      await db.execute(sql`
        SELECT id, standard_batch_kg::text AS standard_batch_kg
          FROM recipes
         WHERE mixture_id = ${a.mixture_id}
           AND is_active AND deleted_at IS NULL
         LIMIT 1
      `),
    );
    if (recepty.length === 0) {
      teoretickaPerZmes.set(a.mixture_id, null);
      continue;
    }
    const kalkulacia = await teoretickaKalkulacia(db, {
      recipeId: recepty[0].id,
    });
    teoretickaPerZmes.set(a.mixture_id, {
      materialCents: kalkulacia.materialCentsSpolu,
      batchKgMilli: parseQty(recepty[0].standard_batch_kg),
    });
  }

  return artikle.map((a) => {
    const dobre = a.dobre ? BigInt(a.dobre) : 0n;
    const normaMilli = parseQty(a.mixture_kg_per_pair);

    const teoreticka = teoretickaPerZmes.get(a.mixture_id);
    const teoretickaZmesCents =
      teoreticka && teoreticka.batchKgMilli > 0n
        ? Number(
            delHalfUp(
              normaMilli * teoreticka.materialCents,
              teoreticka.batchKgMilli,
            ),
          )
        : null;

    let costPerPairCents: string | null = null;
    let marginCents: string | null = null;
    let marginPct: string | null = null;
    let skutocnaZmesCents: string | null = null;
    let skutocnaKgNaPar: string | null = null;

    if (dobre > 0n && a.total_cents !== null) {
      // ×100 = stotiny centa (2 des.), zaokrúhlené RAZ.
      const cost2 = delHalfUp(BigInt(a.total_cents) * 100n, dobre);
      costPerPairCents = formatScaled(cost2, 2);
      if (a.sale_price_cents !== null) {
        const sale2 = BigInt(a.sale_price_cents) * 100n;
        const margin2 = sale2 - cost2;
        marginCents = formatScaled(margin2, 2);
        // % z predajnej ceny na 2 des.: margin/sale × 100 → ×100 (2 des.).
        marginPct = formatScaled(delHalfUp(margin2 * 10000n, sale2), 2);
      }
      if (a.mixture_cents !== null) {
        skutocnaZmesCents = formatScaled(
          delHalfUp(BigInt(a.mixture_cents) * 100n, dobre),
          2,
        );
      }
      if (a.mixture_kg !== null) {
        skutocnaKgNaPar = formatQty(delHalfUp(parseQty(a.mixture_kg), dobre));
      }
    }

    return {
      soleModelId: a.id,
      code: a.code,
      name: a.name,
      salePriceCents: a.sale_price_cents,
      costPerPairCents,
      marginCents,
      marginPct,
      dobreParov: Number(dobre),
      teoretickaZmesCents,
      skutocnaZmesCents,
      normaKgNaPar: a.mixture_kg_per_pair,
      skutocnaKgNaPar,
    };
  });
}
