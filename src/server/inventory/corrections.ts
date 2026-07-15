// Korekcie (M2/M4):
// - stornoVydaja: oprava chybnej navážky protipohybom (korekcia s batch_id
//   pôvodnej dávky + reversed_move_id) — náklad dávky sa ZNÍŽI a zostatok vráti.
// - inventurnaKorekcia: manko/prebytok na konkrétnom lote ako náklad strediska.
// - inventurnaKorekciaMaterialu: manko per MATERIÁL odpísané vo FIFO poradí (D1).
// - cenovaKorekcia: oprava dokladovej ceny (schválená politika ex-OQ3) —
//   v JEDNEJ transakcii prepis ceny lotu + snapshotov pohybov + audit_log diff.
import { eq } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { alokujFifo } from "./fifo";
import { nacitajFifoKandidatov } from "./lots";
import { parseQty } from "./money";

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

/**
 * Cenová korekcia dokladu (F1 — bez uzávierok): prepíše cenu lotu a snapshoty
 * VŠETKÝCH jeho pohybov + zapíše audit_log diff. Náklady dávok tak vždy sedia
 * s opraveným dokladom. (Append-only trigger povoľuje meniť len unit_price.)
 */
export async function cenovaKorekcia(
  db: DbClient,
  vstup: { userId: string; lotId: string; novaCena: string; note?: string },
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

    await tx
      .update(schema.materialLots)
      .set({ unitPrice: vstup.novaCena })
      .where(eq(schema.materialLots.id, vstup.lotId));

    await tx
      .update(schema.stockMoves)
      .set({ unitPrice: vstup.novaCena })
      .where(eq(schema.stockMoves.lotId, vstup.lotId));

    await tx.insert(schema.auditLog).values({
      tableName: "material_lots",
      recordId: vstup.lotId,
      action: "price_correction",
      changedBy: vstup.userId,
      changes: {
        unit_price: { old: lot.unitPrice, new: vstup.novaCena },
        note: vstup.note ?? null,
      },
    });
  });
}
