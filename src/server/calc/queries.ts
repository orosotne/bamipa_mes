// Čítacie queries modulu Kalkulácie (M7) pre server components.
// Zdroj: period_closes + overhead_allocations (archív uzávierok),
// v_batch_full_costs a v_work_order_costs (0007).
import { sql } from "drizzle-orm";
import type { DbClient } from "@/db";

function rows<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : (res as { rows: unknown }).rows) as T[];
}

export type MesiacPrehlad = {
  /** '2026-06-01' */
  period: string;
  uzavrety: boolean;
  /** Σ položiek réžia+služby+energia mesiaca (centy). */
  fakturyCents: number;
  /** korekčné položky mesiaca (centy). */
  korekcieCents: number;
  davkyPocet: number;
  cyklyPocet: number;
  /** dávky bez output_kg — blokujú uzávierku. */
  rozpracovanePocet: number;
};

/** Mesiace s nákladovými dokladmi alebo uzávierkou, od najnovšieho. */
export async function prehladMesiacov(db: DbClient): Promise<MesiacPrehlad[]> {
  return rows<MesiacPrehlad & { fakturyCents: unknown }>(
    await db.execute(sql`
      WITH doklady(m) AS (
        SELECT date_trunc('month', COALESCE(f.delivery_date, f.issue_date, f.due_date))::date
          FROM invoice_items i JOIN invoices f ON f.id = i.invoice_id
         WHERE i.deleted_at IS NULL AND f.deleted_at IS NULL
           AND i.category IN ('rezia', 'sluzby', 'energia')
        UNION
        SELECT date_trunc('month', b.production_date)::date
          FROM production_batches b WHERE b.deleted_at IS NULL
        UNION
        SELECT date_trunc('month', pr.run_date)::date
          FROM press_runs pr WHERE pr.deleted_at IS NULL
        UNION
        SELECT date_trunc('month', wol.work_date)::date
          FROM work_order_labor wol WHERE wol.deleted_at IS NULL
        UNION
        SELECT cc.period_date FROM cost_corrections cc WHERE cc.deleted_at IS NULL
        UNION
        SELECT pc.period FROM period_closes pc WHERE pc.deleted_at IS NULL
      )
      SELECT
        m::text AS "period",
        EXISTS (
          SELECT 1 FROM period_closes pc
           WHERE pc.period = m AND pc.deleted_at IS NULL
        ) AS "uzavrety",
        COALESCE((
          SELECT sum(i.total_net_cents)::bigint
            FROM invoice_items i JOIN invoices f ON f.id = i.invoice_id
           WHERE i.deleted_at IS NULL AND f.deleted_at IS NULL
             AND i.category IN ('rezia', 'sluzby', 'energia')
             AND date_trunc('month', COALESCE(f.delivery_date, f.issue_date, f.due_date))::date = m
        ), 0)::int AS "fakturyCents",
        COALESCE((
          SELECT sum(cc.amount_cents)::bigint FROM cost_corrections cc
           WHERE cc.deleted_at IS NULL AND cc.period_date = m
        ), 0)::int AS "korekcieCents",
        (SELECT count(*) FROM production_batches b
          WHERE b.deleted_at IS NULL AND b.output_kg IS NOT NULL
            AND date_trunc('month', b.production_date)::date = m)::int AS "davkyPocet",
        COALESCE((
          SELECT sum(pr.cycles_count) FROM press_runs pr
           WHERE pr.deleted_at IS NULL
             AND date_trunc('month', pr.run_date)::date = m
        ), 0)::int AS "cyklyPocet",
        (SELECT count(*) FROM production_batches b
          WHERE b.deleted_at IS NULL AND b.output_kg IS NULL
            AND date_trunc('month', b.production_date)::date = m)::int AS "rozpracovanePocet"
      FROM doklady
      GROUP BY m
      ORDER BY m DESC
    `),
  ).map((r) => ({ ...r, fakturyCents: Number(r.fakturyCents) }));
}

export type UzavierkaDetail = {
  close: {
    id: string;
    period: string;
    createdAt: string;
    note: string | null;
  } | null;
  riadky: {
    code: string;
    name: string;
    poolCents: number;
    basis: string;
    rate: string;
  }[];
  davky: {
    batchId: string;
    batchNumber: string;
    status: string;
    outputKg: string | null;
    directCents: number;
    valcovnaCents: number | null;
    labakCents: number | null;
    fullCents: number | null;
    fullPerKg: string | null;
  }[];
  prikazy: {
    workOrderId: string;
    orderNumber: string;
    artikelCode: string;
    artikelName: string;
    pairsProduced: number;
    defectPairs: number;
    scrapKg: string;
    mixtureCents: number | null;
    laborCents: number;
    pressOverheadCents: number | null;
    spravaCents: number | null;
    totalCents: number | null;
    costPerPair: string | null;
  }[];
  /** plné náklady zamietnutých dávok mesiaca — strata (D5 širšie: nikdy sa nelisujú). */
  stratyZamietnuteCents: number;
};

/** Detail mesiaca: archív alokácií + kalkulácie dávok a príkazov mesiaca. */
export async function detailUzavierky(
  db: DbClient,
  period: string,
): Promise<UzavierkaDetail> {
  const [close] = rows<UzavierkaDetail["close"] & object>(
    await db.execute(sql`
      SELECT id, period::text AS period, created_at::text AS "createdAt", note
        FROM period_closes
       WHERE period = ${period} AND deleted_at IS NULL
    `),
  );

  const riadky = close
    ? rows<{ code: string; name: string; poolCents: unknown; basis: string; rate: string }>(
        await db.execute(sql`
          SELECT cc.code, cc.name, oa.pool_cents AS "poolCents",
                 oa.basis::text AS basis, oa.rate::text AS rate
            FROM overhead_allocations oa
            JOIN cost_centers cc ON cc.id = oa.cost_center_id
           WHERE oa.period_close_id = ${close.id}
           ORDER BY array_position(ARRAY['valcovna','lisovna','labak','sprava'], cc.code)
        `),
      ).map((r) => ({ ...r, poolCents: Number(r.poolCents) }))
    : [];

  const davky = rows<{
    batchId: string;
    batchNumber: string;
    status: string;
    outputKg: string | null;
    directCents: unknown;
    valcovnaCents: unknown;
    labakCents: unknown;
    fullCents: unknown;
    fullPerKg: string | null;
  }>(
    await db.execute(sql`
      SELECT fb.batch_id AS "batchId", fb.batch_number AS "batchNumber",
             fb.status::text AS status, fb.output_kg::text AS "outputKg",
             fb.total_cents AS "directCents",
             fb.valcovna_overhead_cents AS "valcovnaCents",
             fb.labak_overhead_cents AS "labakCents",
             fb.full_total_cents AS "fullCents",
             fb.full_cost_per_kg_cents::text AS "fullPerKg"
        FROM v_batch_full_costs fb
        JOIN production_batches b ON b.id = fb.batch_id
       WHERE b.deleted_at IS NULL
         AND date_trunc('month', fb.production_date)::date = ${period}
       ORDER BY fb.batch_number
    `),
  ).map((r) => ({
    ...r,
    directCents: Number(r.directCents),
    valcovnaCents: r.valcovnaCents === null ? null : Number(r.valcovnaCents),
    labakCents: r.labakCents === null ? null : Number(r.labakCents),
    fullCents: r.fullCents === null ? null : Number(r.fullCents),
  }));

  const prikazy = rows<{
    workOrderId: string;
    orderNumber: string;
    artikelCode: string;
    artikelName: string;
    pairsProduced: number;
    defectPairs: number;
    scrapKg: string;
    mixtureCents: unknown;
    laborCents: unknown;
    pressOverheadCents: unknown;
    spravaCents: unknown;
    totalCents: unknown;
    costPerPair: string | null;
  }>(
    await db.execute(sql`
      SELECT v.work_order_id AS "workOrderId", v.order_number AS "orderNumber",
             sm.code AS "artikelCode", sm.name AS "artikelName",
             v.pairs_produced AS "pairsProduced", v.defect_pairs AS "defectPairs",
             v.scrap_kg::text AS "scrapKg",
             v.mixture_cents AS "mixtureCents", v.labor_cents AS "laborCents",
             v.press_overhead_cents AS "pressOverheadCents",
             v.sprava_cents AS "spravaCents", v.total_cents AS "totalCents",
             v.cost_per_pair_cents::text AS "costPerPair"
        FROM v_work_order_costs v
        JOIN sole_models sm ON sm.id = v.sole_model_id
       WHERE EXISTS (
               SELECT 1 FROM press_runs pr
                WHERE pr.work_order_id = v.work_order_id
                  AND pr.deleted_at IS NULL
                  AND date_trunc('month', pr.run_date)::date = ${period}
             )
       ORDER BY v.order_number
    `),
  ).map((r) => ({
    ...r,
    mixtureCents: r.mixtureCents === null ? null : Number(r.mixtureCents),
    laborCents: Number(r.laborCents),
    pressOverheadCents:
      r.pressOverheadCents === null ? null : Number(r.pressOverheadCents),
    spravaCents: r.spravaCents === null ? null : Number(r.spravaCents),
    totalCents: r.totalCents === null ? null : Number(r.totalCents),
  }));

  const [straty] = rows<{ cents: unknown }>(
    await db.execute(sql`
      SELECT COALESCE(sum(fb.full_total_cents), 0)::bigint AS cents
        FROM v_batch_full_costs fb
        JOIN production_batches b ON b.id = fb.batch_id
       WHERE b.deleted_at IS NULL AND fb.status = 'zamietnuta'
         AND date_trunc('month', fb.production_date)::date = ${period}
    `),
  );

  return {
    close: close ?? null,
    riadky,
    davky,
    prikazy,
    stratyZamietnuteCents: Number(straty.cents),
  };
}

export type Nastavenia = {
  energyValcovnaPct: number;
  energyLisovnaPct: number;
};

export async function nacitajNastavenia(db: DbClient): Promise<Nastavenia | null> {
  const [n] = rows<Nastavenia>(
    await db.execute(sql`
      SELECT energy_valcovna_pct AS "energyValcovnaPct",
             energy_lisovna_pct AS "energyLisovnaPct"
        FROM calc_settings
       WHERE code = 'default' AND deleted_at IS NULL
    `),
  );
  return n ?? null;
}
