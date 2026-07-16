// Čítacie queries dashboardu (M8) pre server components a CSV exporty.
// Zdroje: M4/M5/M6 tabuľky (KPI, prestoje), M1 faktúry (cash-flow cez
// zoznamFaktur + bucketujCashflow), M7 views (náklady v čase), M2 šarže
// (trendy cien). Peniaze v centoch; percentá bigint cez delHalfUp,
// zaokrúhlené RAZ na 2 des. miesta.
import { sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import { delHalfUp } from "@/server/calc/alloc-money";
import { formatScaled, parsePrice } from "@/server/inventory/money";

function rows<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : (res as { rows: unknown }).rows) as T[];
}

/** čitateľ/menovateľ → percento na 2 des. ("66.67"); menovateľ > 0. */
function pct2(citatel: number, menovatel: number): string {
  return formatScaled(delHalfUp(BigInt(citatel) * 10000n, BigInt(menovatel)), 2);
}

export type Okno = { od: string; do: string };

export type VyrobneKpi = {
  /** Σ output_kg dávok s production_date v okne (aj zamietnuté — vyrobené kg). */
  kgZmesi: string;
  dobreParov: number;
  nepodarkyParov: number;
  /** nepodarky / (dobré + nepodarky), 2 des.; null bez výroby lisovne. */
  nepodarkovostPct: string | null;
  /** Σ orezu (D5 — KPI odpadovosti) podľa record_date. */
  odpadKg: string;
  /** prestoje valcovne (mesiac dávky) + lisovne (deň výkonu) v minútach. */
  prestojeMinuty: number;
  /** first-pass yield: prvý verdikt dávky = SCHVÁLENÉ / dávky s verdiktom. */
  fpyPct: string | null;
};

export async function vyrobneKpi(db: DbClient, okno: Okno): Promise<VyrobneKpi> {
  const [r] = rows<{
    kg: string;
    dobre: number;
    nepodarky: number;
    odpad: string;
    prestoje: number;
  }>(
    await db.execute(sql`
      SELECT
        COALESCE((
          SELECT sum(b.output_kg) FROM production_batches b
           WHERE b.deleted_at IS NULL
             AND b.production_date BETWEEN ${okno.od}::date AND ${okno.do}::date
        ), 0)::numeric(14,3)::text AS kg,
        COALESCE((
          SELECT sum(pr.pairs_produced) FROM press_runs pr
           WHERE pr.deleted_at IS NULL
             AND pr.run_date BETWEEN ${okno.od}::date AND ${okno.do}::date
        ), 0)::int AS dobre,
        COALESCE((
          SELECT sum(pd.qty_pairs) FROM press_run_defects pd
            JOIN press_runs pr ON pr.id = pd.press_run_id AND pr.deleted_at IS NULL
           WHERE pd.deleted_at IS NULL
             AND pr.run_date BETWEEN ${okno.od}::date AND ${okno.do}::date
        ), 0)::int AS nepodarky,
        COALESCE((
          SELECT sum(sr.qty_kg) FROM scrap_records sr
           WHERE sr.deleted_at IS NULL
             AND sr.record_date BETWEEN ${okno.od}::date AND ${okno.do}::date
        ), 0)::numeric(14,3)::text AS odpad,
        (COALESCE((
          SELECT sum(bd.minutes) FROM batch_downtimes bd
            JOIN production_batches b ON b.id = bd.batch_id AND b.deleted_at IS NULL
           WHERE bd.deleted_at IS NULL
             AND b.production_date BETWEEN ${okno.od}::date AND ${okno.do}::date
        ), 0) + COALESCE((
          SELECT sum(pdw.minutes) FROM press_run_downtimes pdw
            JOIN press_runs pr ON pr.id = pdw.press_run_id AND pr.deleted_at IS NULL
           WHERE pdw.deleted_at IS NULL
             AND pr.run_date BETWEEN ${okno.od}::date AND ${okno.do}::date
        ), 0))::int AS prestoje
    `),
  );

  // FPY: prvé (najnižšie sequence_no) živé meranie dávky; dávky bez verdiktu
  // do FPY nevstupujú (ešte nie sú posúdené).
  const [fpy] = rows<{ testovane: number; prveOk: number }>(
    await db.execute(sql`
      WITH prve AS (
        SELECT DISTINCT ON (t.batch_id) t.batch_id, t.verdict
          FROM lab_tests t
          JOIN production_batches b ON b.id = t.batch_id AND b.deleted_at IS NULL
         WHERE t.deleted_at IS NULL
           AND b.production_date BETWEEN ${okno.od}::date AND ${okno.do}::date
         ORDER BY t.batch_id, t.sequence_no
      )
      SELECT count(*) FILTER (WHERE verdict IS NOT NULL)::int AS "testovane",
             count(*) FILTER (WHERE verdict = 'schvalene')::int AS "prveOk"
        FROM prve
    `),
  );

  const dobre = Number(r.dobre);
  const nepodarky = Number(r.nepodarky);
  const testovane = Number(fpy.testovane);
  return {
    kgZmesi: r.kg,
    dobreParov: dobre,
    nepodarkyParov: nepodarky,
    nepodarkovostPct:
      dobre + nepodarky > 0 ? pct2(nepodarky, dobre + nepodarky) : null,
    odpadKg: r.odpad,
    prestojeMinuty: Number(r.prestoje),
    fpyPct: testovane > 0 ? pct2(Number(fpy.prveOk), testovane) : null,
  };
}

export type PrestojRiadok = {
  reasonCode: string;
  reasonName: string;
  machineCode: string;
  machineName: string;
  /** kód strediska stroja (valcovna / lisovna). */
  prevadzka: string;
  minutes: number;
};

/** Prestoje v okne per dôvod × stroj, od najväčších (SPEC M8, Q5). */
export async function prestoje(db: DbClient, okno: Okno): Promise<PrestojRiadok[]> {
  return rows<PrestojRiadok & { minutes: unknown }>(
    await db.execute(sql`
      SELECT dr.code AS "reasonCode", dr.name AS "reasonName",
             m.code AS "machineCode", m.name AS "machineName",
             cc.code AS "prevadzka",
             sum(x.minutes)::int AS minutes
        FROM (
          SELECT bd.reason_id, b.machine_id, bd.minutes
            FROM batch_downtimes bd
            JOIN production_batches b ON b.id = bd.batch_id AND b.deleted_at IS NULL
           WHERE bd.deleted_at IS NULL
             AND b.production_date BETWEEN ${okno.od}::date AND ${okno.do}::date
          UNION ALL
          SELECT pdw.reason_id, pr.machine_id, pdw.minutes
            FROM press_run_downtimes pdw
            JOIN press_runs pr ON pr.id = pdw.press_run_id AND pr.deleted_at IS NULL
           WHERE pdw.deleted_at IS NULL
             AND pr.run_date BETWEEN ${okno.od}::date AND ${okno.do}::date
        ) x
        JOIN downtime_reasons dr ON dr.id = x.reason_id
        JOIN machines m ON m.id = x.machine_id
        JOIN cost_centers cc ON cc.id = m.cost_center_id
       GROUP BY dr.code, dr.name, m.code, m.name, cc.code
       ORDER BY minutes DESC, dr.code, m.code
    `),
  ).map((r) => ({ ...r, minutes: Number(r.minutes) }));
}

export type NepodarkyRiadok = {
  reasonCode: string;
  reasonName: string;
  machineCode: string;
  machineName: string;
  qtyPairs: number;
};

/** Nepodarky v okne per dôvod × stroj, od najväčších (Q5: kde vznikajú). */
export async function nepodarky(
  db: DbClient,
  okno: Okno,
): Promise<NepodarkyRiadok[]> {
  return rows<NepodarkyRiadok & { qtyPairs: unknown }>(
    await db.execute(sql`
      SELECT dr.code AS "reasonCode", dr.name AS "reasonName",
             m.code AS "machineCode", m.name AS "machineName",
             sum(pd.qty_pairs)::int AS "qtyPairs"
        FROM press_run_defects pd
        JOIN press_runs pr ON pr.id = pd.press_run_id AND pr.deleted_at IS NULL
        JOIN defect_reasons dr ON dr.id = pd.defect_reason_id
        JOIN machines m ON m.id = pr.machine_id
       WHERE pd.deleted_at IS NULL
         AND pr.run_date BETWEEN ${okno.od}::date AND ${okno.do}::date
       GROUP BY dr.code, dr.name, m.code, m.name
       ORDER BY "qtyPairs" DESC, dr.code, m.code
    `),
  ).map((r) => ({ ...r, qtyPairs: Number(r.qtyPairs) }));
}

export type NakladKgBod = {
  mixtureCode: string;
  mixtureName: string;
  /** '2026-06-01' (mesiac dávok). */
  period: string;
  kg: string;
  /** vážený priamy náklad/kg (centy, 2 des.). */
  directPerKg: string;
  /** vážený PLNÝ náklad/kg — null, kým mesiac nie je uzavretý. */
  fullPerKg: string | null;
  uzavrety: boolean;
};

/**
 * Náklad na kg per zmes a mesiac (Q1) — vážený priemer cez dávky mesiaca
 * s output_kg, vrátane zamietnutých (vyrobiť ich reálne stálo peniaze;
 * straty zamietnutých ukazuje uzávierka M7 samostatne).
 */
export async function nakladNaKgMesacne(db: DbClient): Promise<NakladKgBod[]> {
  return rows<NakladKgBod>(
    await db.execute(sql`
      SELECT mx.code AS "mixtureCode", mx.name AS "mixtureName",
             date_trunc('month', fb.production_date)::date::text AS period,
             sum(fb.output_kg)::numeric(14,3)::text AS kg,
             round(sum(fb.total_cents)::numeric(38,20) / sum(fb.output_kg), 2)::text
               AS "directPerKg",
             CASE WHEN bool_and(fb.full_total_cents IS NOT NULL) THEN
               round(sum(fb.full_total_cents)::numeric(38,20) / sum(fb.output_kg), 2)::text
             END AS "fullPerKg",
             bool_and(fb.period_close_id IS NOT NULL) AS uzavrety
        FROM v_batch_full_costs fb
        JOIN production_batches b ON b.id = fb.batch_id AND b.deleted_at IS NULL
        JOIN recipes r ON r.id = b.recipe_id
        JOIN mixtures mx ON mx.id = r.mixture_id
       WHERE fb.output_kg IS NOT NULL
       GROUP BY mx.code, mx.name, period
       ORDER BY period, mx.code
    `),
  );
}

export type NakladParBod = {
  soleModelCode: string;
  soleModelName: string;
  /** mesiac POSLEDNÉHO živého výkonu príkazu (dokončenie výroby). */
  period: string;
  pary: number;
  /** vážený náklad/pár (centy, 2 des.) — null, kým kalkulácia nie je úplná. */
  costPerPair: string | null;
  /** všetky príkazy mesiaca majú úplnú kalkuláciu (total NOT NULL). */
  kompletne: boolean;
};

/** Náklad na pár per artikel a mesiac (Q2) z v_work_order_costs. */
export async function nakladNaParMesacne(db: DbClient): Promise<NakladParBod[]> {
  return rows<NakladParBod & { pary: unknown }>(
    await db.execute(sql`
      WITH mes AS (
        SELECT pr.work_order_id, max(pr.run_date) AS posledny
          FROM press_runs pr
         WHERE pr.deleted_at IS NULL
         GROUP BY pr.work_order_id
      )
      SELECT sm.code AS "soleModelCode", sm.name AS "soleModelName",
             date_trunc('month', mes.posledny)::date::text AS period,
             sum(v.pairs_produced)::int AS pary,
             CASE WHEN bool_and(v.total_cents IS NOT NULL)
                   AND sum(v.pairs_produced) > 0 THEN
               round(sum(v.total_cents)::numeric(38,20) / sum(v.pairs_produced), 2)::text
             END AS "costPerPair",
             bool_and(v.total_cents IS NOT NULL) AS kompletne
        FROM v_work_order_costs v
        JOIN mes ON mes.work_order_id = v.work_order_id
        JOIN sole_models sm ON sm.id = v.sole_model_id
       GROUP BY sm.code, sm.name, period
       ORDER BY period, sm.code
    `),
  ).map((r) => ({ ...r, pary: Number(r.pary) }));
}

// ── Cash-flow kalendár (Q3) ───────────────────────────────────────────────

export type CashflowPolozka = { dueDate: string; zostatokCents: number };

export type CashflowBucket<T> = {
  od: string;
  do: string;
  sumaCents: number;
  pocet: number;
  faktury: T[];
};

export type CashflowBuckety<T> = {
  poSplatnosti: { sumaCents: number; pocet: number; faktury: T[] };
  /** klzavé týždne od `dnes` (7-dňové okná vrátane hraníc). */
  tyzdne: CashflowBucket<T>[];
  neskor: { od: string; sumaCents: number; pocet: number; faktury: T[] };
};

/** ISO dátum ± N dní (UTC aritmetika nad date-only hodnotami). */
export function plusDni(iso: string, dni: number): string {
  const [r, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(r, m - 1, d + dni)).toISOString().slice(0, 10);
}

function rozdielDni(od: string, doDna: string): number {
  const t = (iso: string) => {
    const [r, m, d] = iso.split("-").map(Number);
    return Date.UTC(r, m - 1, d);
  };
  return Math.round((t(doDna) - t(od)) / 86_400_000);
}

/**
 * Rozdelí nezaplatené faktúry (zostatok > 0) na: po splatnosti, N klzavých
 * týždňov od `dnes` a „neskôr". Čistá funkcia — vstup zo zoznamFaktur (M1).
 */
export function bucketujCashflow<T extends CashflowPolozka>(
  faktury: T[],
  dnes: string,
  pocetTyzdnov = 4,
): CashflowBuckety<T> {
  const otvorene = faktury.filter((f) => f.zostatokCents > 0);
  const prazdny = () => ({ sumaCents: 0, pocet: 0, faktury: [] as T[] });

  const poSplatnosti = prazdny();
  const neskor = { od: plusDni(dnes, pocetTyzdnov * 7), ...prazdny() };
  const tyzdne = Array.from({ length: pocetTyzdnov }, (_, i) => ({
    od: plusDni(dnes, i * 7),
    do: plusDni(dnes, i * 7 + 6),
    ...prazdny(),
  }));

  for (const f of otvorene) {
    const dni = rozdielDni(dnes, f.dueDate);
    const bucket =
      dni < 0
        ? poSplatnosti
        : dni >= pocetTyzdnov * 7
          ? neskor
          : tyzdne[Math.floor(dni / 7)];
    bucket.sumaCents += f.zostatokCents;
    bucket.pocet += 1;
    bucket.faktury.push(f);
  }

  return { poSplatnosti, tyzdne, neskor };
}

export type KumulativneSplatne = { dni: number; sumaCents: number; pocet: number };

/**
 * Kumulatívne súčty splatné do 7/14/30 dní od `dnes` (SPEC M8, vrátane
 * hraníc — zhodné s M1 filtrom `splatne_do`). Po splatnosti sem nepatrí,
 * má vlastný alert. Čistá funkcia nad výstupom zoznamFaktur.
 */
export function kumulativneSplatne(
  faktury: CashflowPolozka[],
  dnes: string,
  horizonty: number[] = [7, 14, 30],
): KumulativneSplatne[] {
  const otvorene = faktury.filter((f) => f.zostatokCents > 0);
  return horizonty.map((dni) => {
    const vOkne = otvorene.filter((f) => {
      const d = rozdielDni(dnes, f.dueDate);
      return d >= 0 && d <= dni;
    });
    return {
      dni,
      sumaCents: vOkne.reduce((s, f) => s + f.zostatokCents, 0),
      pocet: vOkne.length,
    };
  });
}

// ── Trendy cien surovín (Q4) ──────────────────────────────────────────────

export type TopMaterial = {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  /** Σ qty × jednotková cena prijatých šarží v okne, zaokrúhlené RAZ (centy). */
  hodnotaCents: number;
  poslednaCena: string;
  /** dodávateľ poslednej ceny (Q4: „od koho"); null = počiatočný stav. */
  poslednyDodavatel: string | null;
  predoslaCena: string | null;
  /** zmena poslednej ceny voči predošlej v % (2 des.); null bez predošlej. */
  zmenaPct: string | null;
  /** body pre sparkline vo FIFO poradí — celá história po `do` (max 20). */
  body: { receivedAt: string; unitPrice: string }[];
};

const SPARKLINE_BODOV = 20;

/** Top materiály podľa hodnoty príjmov v okne (SPEC M8: top 10 cien). */
export async function topMaterialy(
  db: DbClient,
  okno: Okno & { limit?: number },
): Promise<TopMaterial[]> {
  const top = rows<{
    materialId: string;
    code: string;
    name: string;
    unit: string;
    hodnota: unknown;
  }>(
    await db.execute(sql`
      SELECT m.id AS "materialId", m.code, m.name, m.unit::text AS unit,
             round(sum(l.qty_received * l.unit_price))::bigint AS hodnota
        FROM material_lots l
        JOIN receipts r ON r.id = l.receipt_id AND r.deleted_at IS NULL
        JOIN materials m ON m.id = l.material_id AND m.deleted_at IS NULL
       WHERE l.deleted_at IS NULL
         AND r.received_at BETWEEN ${okno.od}::date AND ${okno.do}::date
       GROUP BY m.id, m.code, m.name, m.unit
       ORDER BY hodnota DESC, m.code
       LIMIT ${okno.limit ?? 10}
    `),
  );

  const vysledok: TopMaterial[] = [];
  for (const t of top) {
    // Bez spodnej hranice okna — predošlá cena a trend siahajú aj cez hranicu
    // (nález review: prvý príjem v okne by inak vždy vyzeral „bez zmeny").
    const vsetkyBody = rows<{
      receivedAt: string;
      unitPrice: string;
      dodavatel: string | null;
    }>(
      await db.execute(sql`
        SELECT r.received_at::text AS "receivedAt", l.unit_price::text AS "unitPrice",
               s.name AS "dodavatel"
          FROM material_lots l
          JOIN receipts r ON r.id = l.receipt_id AND r.deleted_at IS NULL
          LEFT JOIN invoices f ON f.id = r.invoice_id AND f.deleted_at IS NULL
          LEFT JOIN suppliers s ON s.id = f.supplier_id
         WHERE l.deleted_at IS NULL AND l.material_id = ${t.materialId}
           AND r.received_at <= ${okno.do}::date
         ORDER BY r.received_at, r.receipt_number, l.line_no
      `),
    );
    const body = vsetkyBody.slice(-SPARKLINE_BODOV);
    const posledna = vsetkyBody[vsetkyBody.length - 1];
    const predosla =
      vsetkyBody.length > 1 ? vsetkyBody[vsetkyBody.length - 2] : null;
    let zmenaPct: string | null = null;
    if (predosla) {
      const p1 = parsePrice(predosla.unitPrice);
      const p2 = parsePrice(posledna.unitPrice);
      zmenaPct = formatScaled(delHalfUp((p2 - p1) * 10000n, p1), 2);
    }
    vysledok.push({
      materialId: t.materialId,
      code: t.code,
      name: t.name,
      unit: t.unit,
      hodnotaCents: Number(t.hodnota),
      poslednaCena: posledna.unitPrice,
      poslednyDodavatel: posledna.dodavatel,
      predoslaCena: predosla?.unitPrice ?? null,
      zmenaPct,
      body: body.map((b) => ({ receivedAt: b.receivedAt, unitPrice: b.unitPrice })),
    });
  }
  return vysledok;
}
