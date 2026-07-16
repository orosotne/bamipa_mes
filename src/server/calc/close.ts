// Mesačná uzávierka M7 (SPEC M7, workflow 5): pooly réžií z faktúr (réžia +
// služby per stredisko, energia D4 pomerom, cost_corrections, carry-forward
// z mesiacov bez základu) → sadzby D2 → archív v overhead_allocations.
// Idempotenciu drží partial unique index period_closes_period_uq; súbeh
// uzávierky s dokladovými zápismi rieši advisory zámok mesiaca (exkluzívny tu,
// zdieľaný v assert_period_open — doklad nevkĺzne do mesiaca počas uzávierky).
import { sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { sqlState } from "@/server/action-utils";
import { formatQty, parseQty, parseScaled } from "@/server/inventory/money";
import {
  alokujKg,
  aplikujPct,
  delHalfUp,
  prirazkaPct,
  rozdelEnergiu,
  sadzbaCentovNaCyklus,
  sadzbaCentovNaKg,
} from "./alloc-money";

const STREDISKA = ["valcovna", "lisovna", "labak", "sprava"] as const;
export type StrediskoCode = (typeof STREDISKA)[number];

// GLOBÁLNY advisory zámok uzávierok (74201, 0) — exkluzívny pri close/reopen,
// zdieľaný v assert_period_open (0007). Jeden spoločný kľúč serializuje aj
// close(M+1) vs reopen(M) — per-mesiac kľúče sa nekonfliktovali a súbeh
// vedel rozbiť invariant „reopen len poslednej uzávierky" (nález review).
export const ADVISORY_KEY_CLOSE = 74201;

export type AlokacnyRiadok = {
  code: StrediskoCode;
  costCenterId: string;
  poolCents: number;
  /** numeric(16,3): kg / cykly / centy podľa D2 kľúča strediska */
  basis: string;
  /** numeric(18,6): c/kg, c/cyklus alebo % prirážka */
  rate: string;
};

export type UzavierkaSuhrn = {
  close: typeof schema.periodCloses.$inferSelect;
  riadky: AlokacnyRiadok[];
};

/** Tvar výsledku db.execute sa líši per driver (pole vs { rows }). */
function rows<T>(res: unknown): T[] {
  return (
    Array.isArray(res) ? res : (res as { rows: unknown }).rows
  ) as T[];
}

/** "2026-06-01" → "6/2026" (hlášky). */
export function mesiacLabel(period: string): string {
  const [rok, mesiac] = period.split("-");
  return `${Number(mesiac)}/${rok}`;
}

/** "2026-06-01" → "2026-07-01" (čistá reťazcová aritmetika, bez TZ). */
export function dalsiMesiac(period: string): string {
  const [rok, mesiac] = period.split("-").map(Number);
  const dalsi = mesiac === 12 ? { r: rok + 1, m: 1 } : { r: rok, m: mesiac + 1 };
  return `${dalsi.r}-${String(dalsi.m).padStart(2, "0")}-01`;
}

function overObdobie(period: string, dnes: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(period)) {
    throw new Error("Obdobie musí byť 1. deň mesiaca (RRRR-MM-01).");
  }
  if (dnes < dalsiMesiac(period)) {
    throw new Error(
      `Mesiac ${mesiacLabel(period)} ešte neskončil — uzavrieť možno len celý minulý mesiac.`,
    );
  }
}

type Strediska = Record<StrediskoCode, string>;

async function nacitajStrediska(tx: DbClient): Promise<Strediska> {
  const res = rows<{ id: string; code: string }>(
    await tx.execute(sql`
      SELECT id, code FROM cost_centers
       WHERE code IN ('valcovna', 'lisovna', 'labak', 'sprava')
         AND deleted_at IS NULL
    `),
  );
  const mapa = Object.fromEntries(res.map((r) => [r.code, r.id]));
  for (const code of STREDISKA) {
    if (!mapa[code]) {
      throw new Error(`Chýba nákladové stredisko „${code}" — over číselník.`);
    }
  }
  return mapa as Strediska;
}

/**
 * Pooly réžií mesiaca per stredisko: faktúry (réžia + služby) + energia podľa
 * D4 + cenové korekcie (cost_corrections) + carry-forward poolu z najbližšej
 * predchádzajúcej živej uzávierky strediska, ktorá nemala základ (basis = 0).
 */
async function nacitajPooly(
  tx: DbClient,
  period: string,
  strediska: Strediska,
): Promise<Record<StrediskoCode, bigint>> {
  const pooly: Record<StrediskoCode, bigint> = {
    valcovna: 0n,
    lisovna: 0n,
    labak: 0n,
    sprava: 0n,
  };
  const idNaCode = new Map<string, StrediskoCode>(
    STREDISKA.map((code) => [strediska[code], code]),
  );

  // Réžia + služby per stredisko (nákladový mesiac = delivery ?? issue ?? due).
  const reziaSluzby = rows<{ cost_center_id: string; suma: string }>(
    await tx.execute(sql`
      SELECT i.cost_center_id, COALESCE(SUM(i.total_net_cents), 0)::bigint::text AS suma
        FROM invoice_items i
        JOIN invoices f ON f.id = i.invoice_id
       WHERE i.deleted_at IS NULL AND f.deleted_at IS NULL
         AND i.category IN ('rezia', 'sluzby')
         AND date_trunc('month', COALESCE(f.delivery_date, f.issue_date, f.due_date))::date = ${period}
       GROUP BY i.cost_center_id
    `),
  );
  for (const r of reziaSluzby) {
    const code = idNaCode.get(r.cost_center_id);
    if (!code) {
      throw new Error(
        "Réžijná položka faktúry patrí neznámemu stredisku — over číselník.",
      );
    }
    pooly[code] += BigInt(r.suma);
  }

  // Energia: celofiremná suma mesiaca → D4 fixný pomer valcovňa/lisovňa.
  const [energia] = rows<{ suma: string }>(
    await tx.execute(sql`
      SELECT COALESCE(SUM(i.total_net_cents), 0)::bigint::text AS suma
        FROM invoice_items i
        JOIN invoices f ON f.id = i.invoice_id
       WHERE i.deleted_at IS NULL AND f.deleted_at IS NULL
         AND i.category = 'energia'
         AND date_trunc('month', COALESCE(f.delivery_date, f.issue_date, f.due_date))::date = ${period}
    `),
  );
  const [nastavenia] = rows<{ pct: number }>(
    await tx.execute(sql`
      SELECT energy_valcovna_pct AS pct FROM calc_settings
       WHERE code = 'default' AND deleted_at IS NULL
    `),
  );
  if (!nastavenia) {
    throw new Error(
      "Chýbajú alokačné nastavenia (calc_settings) — spusti seed alebo ich zadaj v /kalkulacie/nastavenia.",
    );
  }
  const split = rozdelEnergiu(BigInt(energia.suma), Number(nastavenia.pct));
  pooly.valcovna += split.valcovna;
  pooly.lisovna += split.lisovna;

  // Cenové korekcie zaúčtované do tohto mesiaca.
  const korekcie = rows<{ cost_center_id: string; suma: string }>(
    await tx.execute(sql`
      SELECT cost_center_id, COALESCE(SUM(amount_cents), 0)::bigint::text AS suma
        FROM cost_corrections
       WHERE deleted_at IS NULL AND period_date = ${period}
       GROUP BY cost_center_id
    `),
  );
  for (const r of korekcie) {
    const code = idNaCode.get(r.cost_center_id);
    if (!code) {
      throw new Error(
        "Cenová korekcia patrí neznámemu stredisku — over číselník.",
      );
    }
    pooly[code] += BigInt(r.suma);
  }

  // Carry-forward: pool najbližšej staršej živej uzávierky bez základu.
  for (const code of STREDISKA) {
    const [carry] = rows<{ pool_cents: string; basis: string }>(
      await tx.execute(sql`
        SELECT oa.pool_cents::text AS pool_cents, oa.basis::text AS basis
          FROM overhead_allocations oa
          JOIN period_closes pc
            ON pc.id = oa.period_close_id AND pc.deleted_at IS NULL
         WHERE oa.cost_center_id = ${strediska[code]}
           AND pc.period < ${period}
         ORDER BY pc.period DESC
         LIMIT 1
      `),
    );
    if (carry && parseQty(carry.basis) === 0n) {
      pooly[code] += BigInt(carry.pool_cents);
    }
  }

  return pooly;
}

/**
 * Základ prirážky správy = Σ zložiek mesiaca, na ktoré v_work_order_costs
 * % správy reálne aplikuje: zmes výkonov mesiaca (kg výkonu × plný náklad
 * dávky / output_kg — dávky uzávieraného mesiaca s práve vypočítanými
 * sadzbami, staršie z archívu uzávierok) + réžia lisovne (cykly × sadzba)
 * + priama práca lisovne. Medzisúčty v mikrocentoch (presné zlomky zmesi),
 * na centy sa zaokrúhľuje RAZ.
 */
async function spravaZakladCents(
  tx: DbClient,
  period: string,
  vstup: {
    rateValcovna: string;
    labakPct: string;
    rateLisovna: string;
    cykly: bigint;
    /** Σ hodín × sadzba lisovne, presný numeric(16,2) string */
    lisPraca: string;
  },
): Promise<bigint> {
  const runy = rows<{
    kg: string;
    output: string;
    batch_number: string;
    batch_mesiac: string;
    direct: string;
    full_z_uzavierky: string | null;
  }>(
    await tx.execute(sql`
      SELECT pr.mixture_kg::text AS kg,
             fb.output_kg::text AS output,
             fb.batch_number,
             date_trunc('month', fb.production_date)::date::text AS batch_mesiac,
             fb.total_cents::text AS direct,
             fb.full_total_cents::text AS full_z_uzavierky
        FROM press_runs pr
        JOIN v_batch_full_costs fb ON fb.batch_id = pr.batch_id
       WHERE pr.deleted_at IS NULL
         AND date_trunc('month', pr.run_date)::date = ${period}
    `),
  );

  let micro = 0n;
  for (const r of runy) {
    const kgMilli = parseQty(r.kg);
    const outputMilli = parseQty(r.output);
    let full: bigint;
    if (r.batch_mesiac === period) {
      const direct = BigInt(r.direct);
      full =
        direct +
        alokujKg(outputMilli, vstup.rateValcovna) +
        aplikujPct(direct, vstup.labakPct);
    } else if (r.full_z_uzavierky !== null) {
      full = BigInt(r.full_z_uzavierky);
    } else {
      // Chronológia + hranica uzávierok to vylučujú — defenzívny backstop.
      throw new Error(
        `Dávka ${r.batch_number} má výkon v uzávieranom mesiaci, ale jej mesiac nie je uzavretý — over chronológiu uzávierok.`,
      );
    }
    micro += delHalfUp(kgMilli * full * 1_000_000n, outputMilli);
  }
  micro += vstup.cykly * parseScaled(vstup.rateLisovna, 6, "sadzby");
  micro += parseScaled(vstup.lisPraca, 2, "práce lisovne") * 10_000n;
  return delHalfUp(micro, 1_000_000n);
}

/**
 * Uzavrie mesiac: validácie (celý minulý mesiac, chronológia, hranica
 * uzávierok, dávky s output_kg) → pooly → sadzby D2 → period_closes +
 * overhead_allocations v jednej transakcii. `dnes` = dnešný dátum
 * Europe/Bratislava (YYYY-MM-DD), podáva ho action vrstva (dnesnyDatum) —
 * služba je deterministická.
 */
export async function uzavriMesiac(
  db: DbClient,
  vstup: { period: string; userId: string; dnes: string },
): Promise<UzavierkaSuhrn> {
  const { period, userId, dnes } = vstup;
  overObdobie(period, dnes);

  try {
    return await db.transaction(async (tx) => {
      // Globálny exkluzívny zámok — páruje sa so zdieľaným v assert_period_open.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${ADVISORY_KEY_CLOSE}, 0)`,
      );

      const [uzUzavrety] = rows<{ id: string }>(
        await tx.execute(sql`
          SELECT id FROM period_closes
           WHERE period = ${period} AND deleted_at IS NULL
        `),
      );
      if (uzUzavrety) {
        throw new Error(`Mesiac ${mesiacLabel(period)} je už uzavretý.`);
      }

      // Hranica uzávierok: uzavrieť možno len mesiac NAD poslednou živou
      // uzávierkou — dodatočná uzávierka „medzery" by rozbila carry-forward
      // reťaz (jej pool by už nikto nepreniesol — nález review).
      const [hranica] = rows<{ max: string | null }>(
        await tx.execute(sql`
          SELECT max(period)::text AS max FROM period_closes
           WHERE deleted_at IS NULL
        `),
      );
      if (hranica?.max && hranica.max >= period) {
        throw new Error(
          `Mesiac ${mesiacLabel(period)} je starší než posledná uzávierka (${mesiacLabel(hranica.max)}) — uzávierky idú chronologicky.`,
        );
      }

      // Chronológia: najstarší neuzavretý mesiac s nákladovými dokladmi.
      const [starsi] = rows<{ m: string | null }>(
        await tx.execute(sql`
          SELECT min(m)::text AS m FROM (
            SELECT date_trunc('month', COALESCE(f.delivery_date, f.issue_date, f.due_date))::date AS m
              FROM invoice_items i JOIN invoices f ON f.id = i.invoice_id
             WHERE i.deleted_at IS NULL AND f.deleted_at IS NULL
               AND i.category IN ('rezia', 'sluzby', 'energia')
            UNION ALL
            SELECT date_trunc('month', b.production_date)::date
              FROM production_batches b WHERE b.deleted_at IS NULL
            UNION ALL
            SELECT date_trunc('month', pr.run_date)::date
              FROM press_runs pr WHERE pr.deleted_at IS NULL
            UNION ALL
            SELECT date_trunc('month', wol.work_date)::date
              FROM work_order_labor wol WHERE wol.deleted_at IS NULL
            UNION ALL
            SELECT cc.period_date FROM cost_corrections cc
             WHERE cc.deleted_at IS NULL
          ) doklady(m)
          WHERE m < ${period}
            AND NOT EXISTS (
              SELECT 1 FROM period_closes pc
               WHERE pc.period = doklady.m AND pc.deleted_at IS NULL
            )
        `),
      );
      if (starsi?.m) {
        throw new Error(
          `Najprv uzavri starší mesiac ${mesiacLabel(starsi.m)} — uzávierky idú chronologicky.`,
        );
      }

      // Dávky mesiaca bez vyrobených kg nemajú alokačný základ — dokončiť.
      const rozpracovane = rows<{ batch_number: string }>(
        await tx.execute(sql`
          SELECT batch_number FROM production_batches
           WHERE deleted_at IS NULL AND output_kg IS NULL
             AND date_trunc('month', production_date)::date = ${period}
           ORDER BY batch_number
        `),
      );
      if (rozpracovane.length > 0) {
        throw new Error(
          `Dávky bez vyrobených kg blokujú uzávierku ${mesiacLabel(period)}: ${rozpracovane
            .map((r) => r.batch_number)
            .join(", ")}. Dokonči ich alebo zmaž.`,
        );
      }

      const strediska = await nacitajStrediska(tx);
      const pooly = await nacitajPooly(tx, period, strediska);

      // Základy D2.
      const [kg] = rows<{ suma: string }>(
        await tx.execute(sql`
          SELECT COALESCE(SUM(output_kg), 0)::numeric(16,3)::text AS suma
            FROM production_batches
           WHERE deleted_at IS NULL AND output_kg IS NOT NULL
             AND date_trunc('month', production_date)::date = ${period}
        `),
      );
      const [cykly] = rows<{ suma: string }>(
        await tx.execute(sql`
          SELECT COALESCE(SUM(cycles_count), 0)::bigint::text AS suma
            FROM press_runs
           WHERE deleted_at IS NULL
             AND date_trunc('month', run_date)::date = ${period}
        `),
      );
      const [direct] = rows<{ suma: string }>(
        await tx.execute(sql`
          SELECT COALESCE(SUM(bc.total_cents), 0)::bigint::text AS suma
            FROM v_batch_costs bc
            JOIN production_batches b ON b.id = bc.batch_id
           WHERE b.deleted_at IS NULL AND b.output_kg IS NOT NULL
             AND date_trunc('month', b.production_date)::date = ${period}
        `),
      );
      // Presné 2 des. miesta (hodiny×sadzba) — do základu správy bez
      // medzizaokrúhlenia.
      const [lisPraca] = rows<{ suma: string }>(
        await tx.execute(sql`
          SELECT COALESCE(SUM(wol.hours * wol.hourly_rate_cents), 0)::numeric(16,2)::text AS suma
            FROM work_order_labor wol
           WHERE wol.deleted_at IS NULL
             AND date_trunc('month', wol.work_date)::date = ${period}
        `),
      );

      const kgMilli = parseQty(kg.suma);
      const cyklyPocet = BigInt(cykly.suma);
      const directCents = BigInt(direct.suma);

      const nula = { basis: "0.000", rate: "0.000000" };
      const zakladValcovna =
        kgMilli > 0n
          ? {
              basis: formatQty(kgMilli),
              rate: sadzbaCentovNaKg(pooly.valcovna, kgMilli),
            }
          : nula;
      const zakladLisovna =
        cyklyPocet > 0n
          ? {
              basis: `${cyklyPocet}.000`,
              rate: sadzbaCentovNaCyklus(pooly.lisovna, cyklyPocet),
            }
          : nula;
      const zakladLabak =
        directCents > 0n
          ? {
              basis: `${directCents}.000`,
              rate: prirazkaPct(pooly.labak, directCents),
            }
          : nula;

      // Základ správy = zložky mesiaca, na ktoré v_work_order_costs prirážku
      // reálne aplikuje (zmes výkonov + réžia lisovne + práca lisovne) —
      // Σ alokovanej správy tak sadne na pool a mesiac bez lisovania má
      // basis 0 → pool sa prenáša ďalej (nálezy review: strata poolu správy
      // a dvojité počítanie poolov v základe).
      const spravaZaklad = await spravaZakladCents(tx, period, {
        rateValcovna: zakladValcovna.rate,
        labakPct: zakladLabak.rate,
        rateLisovna: zakladLisovna.rate,
        cykly: cyklyPocet,
        lisPraca: lisPraca.suma,
      });
      const zakladSprava =
        spravaZaklad > 0n
          ? {
              basis: `${spravaZaklad}.000`,
              rate: prirazkaPct(pooly.sprava, spravaZaklad),
            }
          : nula;

      const zaklady: Record<StrediskoCode, { basis: string; rate: string }> = {
        valcovna: zakladValcovna,
        lisovna: zakladLisovna,
        labak: zakladLabak,
        sprava: zakladSprava,
      };

      const [close] = await tx
        .insert(schema.periodCloses)
        .values({ period, createdBy: userId })
        .returning();

      const riadky: AlokacnyRiadok[] = [];
      for (const code of STREDISKA) {
        const poolCents = Number(pooly[code]);
        await tx.insert(schema.overheadAllocations).values({
          periodCloseId: close.id,
          costCenterId: strediska[code],
          poolCents,
          basis: zaklady[code].basis,
          rate: zaklady[code].rate,
          createdBy: userId,
        });
        riadky.push({
          code,
          costCenterId: strediska[code],
          poolCents,
          basis: zaklady[code].basis,
          rate: zaklady[code].rate,
        });
      }

      await tx.insert(schema.auditLog).values({
        tableName: "period_closes",
        recordId: close.id,
        action: "period_close",
        changedBy: userId,
        changes: { period, riadky },
      });

      return { close, riadky };
    });
  } catch (e) {
    // Súbeh dvoch uzávierok: partial unique index → doménová hláška.
    if (sqlState(e) === "23505") {
      throw new Error(`Mesiac ${mesiacLabel(period)} je už uzavretý.`);
    }
    throw e;
  }
}

/**
 * Reopen (len admin — vynucuje action vrstva): soft delete POSLEDNEJ živej
 * uzávierky. Staršie sa otvárať nesmú (novšie sadzby by stáli na neuzavretom
 * podklade); archív alokácií ostáva na zmazanej uzávierke.
 */
export async function otvorMesiac(
  db: DbClient,
  vstup: { period: string; userId: string },
): Promise<void> {
  const { period, userId } = vstup;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${ADVISORY_KEY_CLOSE}, 0)`,
    );

    const [close] = rows<{ id: string; period: string }>(
      await tx.execute(sql`
        SELECT id, period::text AS period FROM period_closes
         WHERE period = ${period} AND deleted_at IS NULL
      `),
    );
    if (!close) {
      throw new Error(`Uzávierka ${mesiacLabel(period)} neexistuje.`);
    }

    const [posledna] = rows<{ period: string }>(
      await tx.execute(sql`
        SELECT period::text AS period FROM period_closes
         WHERE deleted_at IS NULL
         ORDER BY period DESC
         LIMIT 1
      `),
    );
    if (posledna.period !== period) {
      throw new Error(
        `Otvoriť možno len poslednú uzávierku (${mesiacLabel(posledna.period)}).`,
      );
    }

    await tx.execute(
      sql`UPDATE period_closes SET deleted_at = now() WHERE id = ${close.id}`,
    );
    await tx.insert(schema.auditLog).values({
      tableName: "period_closes",
      recordId: close.id,
      action: "period_reopen",
      changedBy: userId,
      changes: { period },
    });
  });
}
