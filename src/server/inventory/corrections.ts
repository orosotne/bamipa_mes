// Korekcie (M2/M4):
// - stornoVydaja: oprava chybnej navážky protipohybom (korekcia s batch_id
//   pôvodnej dávky + reversed_move_id) — náklad dávky sa ZNÍŽI a zostatok vráti.
// - inventurnaKorekcia: manko/prebytok na konkrétnom lote ako náklad strediska.
// - inventurnaKorekciaMaterialu: manko per MATERIÁL odpísané vo FIFO poradí (D1).
// - cenovaKorekcia: oprava dokladovej ceny (schválená politika ex-OQ3) —
//   v JEDNEJ transakcii prepis ceny lotu + snapshotov pohybov OTVORENÝCH
//   mesiacov + audit_log diff. Pohyby UZAVRETÝCH mesiacov (M7 uzávierky)
//   sa neprepisujú — cenový rozdiel sa účtuje ako cost_corrections do
//   aktuálneho mesiaca (dávkové pohyby → valcovňa, inventúrne → stredisko
//   pohybu; príjem nie je nákladový doklad). DB backstop: trigger
//   stock_moves_period_lock (0007).
import { eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { alokujFifo } from "./fifo";
import { nacitajFifoKandidatov } from "./lots";
import { formatPrice, parsePrice, parseQty, sumLineCostsCents } from "./money";

export type VysledokKorekcie = {
  pohyb: typeof schema.stockMoves.$inferSelect;
};

/** Storno CELÉHO vydaj pohybu (oprava preklepu = storno + nový správny výdaj). */
export async function stornoVydaja(
  db: DbClient,
  vstup: { userId: string; moveId: string; note?: string },
): Promise<VysledokKorekcie> {
  return db.transaction(async (tx) => {
    const [povodny] = await tx
      .select()
      .from(schema.stockMoves)
      .where(eq(schema.stockMoves.id, vstup.moveId));

    if (!povodny) {
      throw new Error(`Pohyb ${vstup.moveId} neexistuje.`);
    }
    if (povodny.moveType !== "vydaj") {
      throw new Error(
        `Stornovať možno len vydaj pohyb (tento je „${povodny.moveType}").`,
      );
    }

    // vydaj pohyb má vždy batch_id (CHECK stock_moves_vydaj_requires_batch) —
    // storno smie meniť náklad dávky len kým je rozpracovaná (server-side
    // zámok, nielen skryté UI — SPEC §12 "over aj cez API").
    const [davka] = await tx
      .select({ status: schema.productionBatches.status })
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.id, povodny.batchId as string));
    if (davka && davka.status !== "rozpracovana") {
      throw new Error(
        `Dávka je uzamknutá (stav „${davka.status}") — výdaj nemožno stornovať.`,
      );
    }

    const [uzStornovany] = await tx
      .select({ id: schema.stockMoves.id })
      .from(schema.stockMoves)
      .where(eq(schema.stockMoves.reversedMoveId, povodny.id));
    if (uzStornovany) {
      throw new Error("Pohyb už bol stornovaný — nemožno stornovať dvakrát.");
    }

    // Protipohyb: kladné delta, batch/adjustment aj snapshot cena z pôvodného.
    const [pohyb] = await tx
      .insert(schema.stockMoves)
      .values({
        lotId: povodny.lotId,
        moveType: "korekcia",
        qtyDelta: povodny.qtyDelta.replace("-", ""),
        batchId: povodny.batchId,
        adjustmentId: povodny.adjustmentId,
        reversedMoveId: povodny.id,
        unitPrice: povodny.unitPrice,
        note: vstup.note,
        createdBy: vstup.userId,
      })
      .returning();

    return { pohyb };
  });
}

/** Inventúrne manko (−) / prebytok (+) na konkrétnom lote za jeho cenu. */
export async function inventurnaKorekcia(
  db: DbClient,
  vstup: {
    userId: string;
    lotId: string;
    /** signed numeric(12,3) string: manko záporné, prebytok kladné */
    qtyDelta: string;
    costCenterId: string;
    note?: string;
  },
): Promise<VysledokKorekcie> {
  if (parseQty(vstup.qtyDelta) === 0n) {
    throw new Error("Inventúrna korekcia musí meniť množstvo (delta ≠ 0).");
  }

  return db.transaction(async (tx) => {
    const [pohyb] = await tx
      .insert(schema.stockMoves)
      .values({
        lotId: vstup.lotId,
        moveType: "korekcia",
        qtyDelta: vstup.qtyDelta,
        costCenterId: vstup.costCenterId,
        unitPrice: (
          await tx
            .select({ unitPrice: schema.materialLots.unitPrice })
            .from(schema.materialLots)
            .where(eq(schema.materialLots.id, vstup.lotId))
        )[0].unitPrice,
        note: vstup.note,
        createdBy: vstup.userId,
      })
      .returning();

    return { pohyb };
  });
}

export type VysledokKorekcieMaterialu = {
  pohyby: (typeof schema.stockMoves.$inferSelect)[];
};

/**
 * Inventúrne manko na úrovni MATERIÁLU — fyzická inventúra pozná rozdiel
 * per materiál, nie per šaržu. Manko sa odpisuje vo FIFO poradí (D1)
 * rovnakým transakčným protokolom ako výdaj: SELECT kandidátnych lotov
 * FOR UPDATE → čistá alokácia → korekčné pohyby per šarža, každý s cenou
 * SVOJEJ šarže a povinným strediskom. Prebytok ostáva per šarža
 * (inventurnaKorekcia) — nemá FIFO semantiku.
 */
export async function inventurnaKorekciaMaterialu(
  db: DbClient,
  vstup: {
    userId: string;
    materialId: string;
    /** manko ako KLADNÉ množstvo (numeric(12,3) string) */
    qty: string;
    costCenterId: string;
    note?: string;
  },
): Promise<VysledokKorekcieMaterialu> {
  return db.transaction(async (tx) => {
    const kandidati = await nacitajFifoKandidatov(tx, vstup.materialId);

    // Pri nedostatku hodí NedostatokZasobyError — transakcia sa vráti
    // bez jediného pohybu.
    const alokacia = alokujFifo(kandidati, vstup.qty);

    const pohyby: (typeof schema.stockMoves.$inferSelect)[] = [];
    for (const riadok of alokacia) {
      const [pohyb] = await tx
        .insert(schema.stockMoves)
        .values({
          lotId: riadok.lotId,
          moveType: "korekcia",
          qtyDelta: `-${riadok.qty}`,
          costCenterId: vstup.costCenterId,
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

/** "−50.000" → "50.000" a naopak (otočenie znamienka numeric stringu). */
function otocZnamienko(qty: string): string {
  return qty.startsWith("-") ? qty.slice(1) : `-${qty}`;
}

/**
 * Cenová korekcia dokladu (schválená politika ex-OQ3): prepíše cenu lotu
 * (budúce výdaje) a snapshoty pohybov OTVORENÝCH mesiacov — náklady
 * otvorených dávok tak sedia s opraveným dokladom. Pohyby UZAVRETÝCH
 * mesiacov ostávajú nedotknuté (archív kalkulácií platí); ich cenový rozdiel
 * Σ(−qty × Δcena) sa zaúčtuje ako cost_corrections do mesiaca `dnes`
 * (zaokrúhlenie RAZ per stredisko) a vstúpi do réžií jeho uzávierky.
 */
export async function cenovaKorekcia(
  db: DbClient,
  vstup: {
    userId: string;
    lotId: string;
    novaCena: string;
    note?: string;
    /** Dnešný dátum Europe/Bratislava (YYYY-MM-DD) — mesiac zaúčtovania. */
    dnes: string;
  },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [lot] = await tx
      .select()
      .from(schema.materialLots)
      .where(eq(schema.materialLots.id, vstup.lotId));

    if (!lot) {
      throw new Error(`Šarža ${vstup.lotId} neexistuje.`);
    }
    if (lot.unitPrice === vstup.novaCena) {
      throw new Error("Nová cena je zhodná s aktuálnou — niet čo korigovať.");
    }

    // Pohyby lotu s mesiacom dokladu: dávkové podľa production_date dávky,
    // ostatné (príjem, inventúrne korekcie) podľa dátumu vzniku pohybu
    // v Europe/Bratislava (zhodné s triggerom lock_stock_move_period).
    // Mesiac je zamknutý ⇔ nie je nad hranicou poslednej živej uzávierky
    // (vrátane nikdy neuzavretých medzier — zhodné s assert_period_open).
    const res = await tx.execute(sql`
      SELECT sm.id,
             sm.qty_delta::text AS qty_delta,
             sm.move_type::text AS move_type,
             sm.cost_center_id,
             date_trunc('month',
               COALESCE(b.production_date,
                 (sm.created_at AT TIME ZONE 'Europe/Bratislava')::date))::date
               <= (SELECT max(pc.period) FROM period_closes pc
                    WHERE pc.deleted_at IS NULL) AS uzavrety
        FROM stock_moves sm
        LEFT JOIN production_batches b ON b.id = sm.batch_id
       WHERE sm.lot_id = ${vstup.lotId}
    `);
    const pohyby = (
      Array.isArray(res) ? res : (res as { rows: unknown }).rows
    ) as {
      id: string;
      qty_delta: string;
      move_type: string;
      cost_center_id: string | null;
      /** NULL, keď neexistuje žiadna uzávierka (porovnanie s NULL max). */
      uzavrety: boolean | null;
    }[];

    await tx
      .update(schema.materialLots)
      .set({ unitPrice: vstup.novaCena })
      .where(eq(schema.materialLots.id, vstup.lotId));

    const otvorene = pohyby.filter((p) => !p.uzavrety).map((p) => p.id);
    if (otvorene.length > 0) {
      await tx
        .update(schema.stockMoves)
        .set({ unitPrice: vstup.novaCena })
        .where(inArray(schema.stockMoves.id, otvorene));
    }

    // Rozdiel za uzavreté NÁKLADOVÉ pohyby (príjem vynechaný) per stredisko.
    const deltaCena = formatPrice(
      parsePrice(vstup.novaCena) - parsePrice(lot.unitPrice),
    );
    const podlaStrediska = new Map<string, { qty: string; price: string }[]>();
    let valcovnaId: string | null = null;
    for (const p of pohyby) {
      if (!p.uzavrety || p.move_type === "prijem") continue;
      let strediskoId = p.cost_center_id;
      if (!strediskoId) {
        if (!valcovnaId) {
          const [valcovna] = await tx
            .select({ id: schema.costCenters.id })
            .from(schema.costCenters)
            .where(
              sql`${schema.costCenters.code} = 'valcovna' AND ${schema.costCenters.deletedAt} IS NULL`,
            );
          if (!valcovna) {
            throw new Error(`Chýba nákladové stredisko „valcovna" — over číselník.`);
          }
          valcovnaId = valcovna.id;
        }
        strediskoId = valcovnaId;
      }
      const riadky = podlaStrediska.get(strediskoId) ?? [];
      // Náklad pohybu je −qty × cena → rozdiel nákladu je −qty × Δcena
      // (storno pár vydaj/korekcia sa tak prirodzene vynuluje).
      riadky.push({ qty: otocZnamienko(p.qty_delta), price: deltaCena });
      podlaStrediska.set(strediskoId, riadky);
    }

    const periodDate = `${vstup.dnes.slice(0, 7)}-01`;
    const korekcie: { cost_center_id: string; amount_cents: number }[] = [];
    for (const [strediskoId, riadky] of podlaStrediska) {
      const amount = sumLineCostsCents(riadky);
      if (amount === 0n) continue;
      await tx.insert(schema.costCorrections).values({
        lotId: vstup.lotId,
        costCenterId: strediskoId,
        periodDate,
        amountCents: Number(amount),
        note: vstup.note,
        createdBy: vstup.userId,
      });
      korekcie.push({
        cost_center_id: strediskoId,
        amount_cents: Number(amount),
      });
    }

    await tx.insert(schema.auditLog).values({
      tableName: "material_lots",
      recordId: vstup.lotId,
      action: "price_correction",
      changedBy: vstup.userId,
      changes: {
        unit_price: { old: lot.unitPrice, new: vstup.novaCena },
        note: vstup.note ?? null,
        uzavrete_pohyby: pohyby.filter((p) => p.uzavrety).length,
        cost_corrections: korekcie,
      },
    });
  });
}
