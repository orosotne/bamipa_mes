// Živá teoretická kalkulácia receptu (M3, rozhodnutie OQ2 = FIFO simulácia):
// simuluje čerpanie aktuálnych zostatkov vo FIFO poradí — teoretická cena je
// tak porovnateľná so skutočnou kalkuláciou dávky. Nedostatok sa oceňuje cenou
// najnovšieho lotu (bez lotov = 0) a označí maNedostatok — informatívne, nie
// blokujúce. Zaokrúhľuje sa raz PER POLOŽKA (zobrazované riadky), spolu = Σ
// položiek — obrazovka sedí so súčtom.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { porovnajFifo, type FifoLot } from "./fifo";
import { formatQty, parseQty, sumLineCostsCents } from "./money";

export type PolozkaTeoretickejKalkulacie = {
  materialId: string;
  materialCode: string;
  materialName: string;
  /** požadované kg (qty receptu × scale factor) */
  qtyKg: string;
  /** teoretický náklad položky v centoch */
  materialCents: bigint;
  maNedostatok: boolean;
  /** koľko kg chýba na sklade (null ak nič) */
  chybaKg: string | null;
};

export type TeoretickaKalkulacia = {
  polozky: PolozkaTeoretickejKalkulacie[];
  materialCentsSpolu: bigint;
  maNedostatok: boolean;
};

/** qty(×10³) × scale(×10³) → ×10³, half up. */
function aplikujScale(qtyMilli: bigint, scaleMilli: bigint): bigint {
  return (qtyMilli * scaleMilli * 2n + 1000n) / 2000n;
}

export async function teoretickaKalkulacia(
  db: DbClient,
  vstup: { recipeId: string; scaleFactor?: string },
): Promise<TeoretickaKalkulacia> {
  const [recept] = await db
    .select()
    .from(schema.recipes)
    .where(eq(schema.recipes.id, vstup.recipeId));
  if (!recept) {
    throw new Error(`Recept ${vstup.recipeId} neexistuje.`);
  }

  const scaleMilli = parseQty(vstup.scaleFactor ?? "1");
  if (scaleMilli <= 0n) {
    throw new Error("Scale factor musí byť kladný.");
  }

  const polozkyReceptu = await db
    .select({
      materialId: schema.recipeItems.materialId,
      materialCode: schema.materials.code,
      materialName: schema.materials.name,
      qtyKg: schema.recipeItems.qtyKg,
      sortOrder: schema.recipeItems.sortOrder,
    })
    .from(schema.recipeItems)
    .innerJoin(
      schema.materials,
      eq(schema.recipeItems.materialId, schema.materials.id),
    )
    .where(eq(schema.recipeItems.recipeId, vstup.recipeId))
    .orderBy(schema.recipeItems.sortOrder);

  const polozky: PolozkaTeoretickejKalkulacie[] = [];

  for (const polozka of polozkyReceptu) {
    const pozadovaneMilli = aplikujScale(parseQty(polozka.qtyKg), scaleMilli);

    const loty: FifoLot[] = await db
      .select({
        id: schema.materialLots.id,
        receivedAt: schema.receipts.receivedAt,
        receiptNumber: schema.receipts.receiptNumber,
        lineNo: schema.materialLots.lineNo,
        qtyRemaining: schema.materialLots.qtyRemaining,
        unitPrice: schema.materialLots.unitPrice,
      })
      .from(schema.materialLots)
      .innerJoin(
        schema.receipts,
        eq(schema.materialLots.receiptId, schema.receipts.id),
      )
      .where(
        and(
          eq(schema.materialLots.materialId, polozka.materialId),
          isNull(schema.materialLots.deletedAt),
          gt(schema.materialLots.qtyRemaining, sql`0`),
        ),
      );

    loty.sort(porovnajFifo);

    // Simulácia FIFO čerpania — čiastočná alokácia povolená.
    const riadky: { qty: string; price: string }[] = [];
    let zostava = pozadovaneMilli;
    for (const lot of loty) {
      if (zostava === 0n) break;
      const dostupne = parseQty(lot.qtyRemaining);
      const zoberiem = dostupne < zostava ? dostupne : zostava;
      riadky.push({ qty: formatQty(zoberiem), price: lot.unitPrice });
      zostava -= zoberiem;
    }

    // Nedostatok: chýbajúce kg za cenu NAJNOVŠIEHO lotu (posledný vo FIFO
    // poradí); bez jediného lotu cena neexistuje → 0 c (viditeľné cez flag).
    if (zostava > 0n && loty.length > 0) {
      riadky.push({
        qty: formatQty(zostava),
        price: loty[loty.length - 1].unitPrice,
      });
    }

    polozky.push({
      materialId: polozka.materialId,
      materialCode: polozka.materialCode,
      materialName: polozka.materialName,
      qtyKg: formatQty(pozadovaneMilli),
      materialCents: sumLineCostsCents(riadky),
      maNedostatok: zostava > 0n,
      chybaKg: zostava > 0n ? formatQty(zostava) : null,
    });
  }

  return {
    polozky,
    materialCentsSpolu: polozky.reduce((sum, p) => sum + p.materialCents, 0n),
    maNedostatok: polozky.some((p) => p.maNedostatok),
  };
}
