"use server";

// Tenké server actions pre M2 sklad — Zod validácia, konverzie, služby.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, type DbClient } from "@/db";
import { parseEurPerUnitToPrice } from "@/lib/format";
import {
  naVysledok,
  normalizujQty,
  sqlState,
  type VysledokAkcie,
} from "@/server/action-utils";
import {
  cenovaKorekcia,
  inventurnaKorekcia,
  inventurnaKorekciaMaterialu,
} from "@/server/inventory/corrections";
import { pociatocnyStav, prijemZoFaktury } from "@/server/inventory/receipts";
import {
  createMaterial,
  nastavPredvolenychDodavatelov,
  softDeleteMaterial,
  updateMaterial,
} from "@/server/materials/service";
import { getCurrentUser } from "@/server/session";
import { generujCisloPrijemky } from "@/server/warehouse/numbering";

const materialSchema = z.object({
  code: z.string().trim().min(1, "Kód materiálu je povinný."),
  name: z.string().trim().min(1, "Názov materiálu je povinný."),
  unit: z.enum(["kg", "l", "ks"]),
  category: z.enum([
    "kaucuk",
    "plnivo",
    "olej",
    "chemikalia",
    "obalovy_material",
    "ine",
  ]),
  minStockQty: z.string().trim().optional(),
  note: z.string().trim().optional(),
  supplierIds: z.array(z.string().uuid()).default([]),
});

export async function ulozMaterialAction(
  id: string | null,
  vstup: z.input<typeof materialSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = materialSchema.parse(vstup);
    const user = await getCurrentUser(db);

    const polia = {
      userId: user.id,
      code: data.code,
      name: data.name,
      unit: data.unit,
      category: data.category,
      minStockQty: data.minStockQty
        ? normalizujQty(data.minStockQty, "Minimálna zásoba")
        : null,
      note: data.note || null,
    };

    // Jedna logická operácia = jedna transakcia (nested tx = savepointy) —
    // pád na dodávateľoch nesmie nechať materiál napoly uložený.
    await db.transaction(async (tx) => {
      const material = id
        ? await updateMaterial(tx as DbClient, { ...polia, id })
        : await createMaterial(tx as DbClient, polia);

      await nastavPredvolenychDodavatelov(tx as DbClient, {
        userId: user.id,
        materialId: material.id,
        supplierIds: data.supplierIds,
      });
    });

    revalidatePath("/sklad");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function zmazMaterialAction(id: string): Promise<VysledokAkcie> {
  try {
    const user = await getCurrentUser(db);
    await softDeleteMaterial(db, { userId: user.id, id });
    revalidatePath("/sklad");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const korekciaSchema = z.object({
  lotId: z.string().uuid(),
  materialId: z.string().uuid(),
  smer: z.enum(["manko", "prebytok"]),
  qty: z.string().trim().min(1, "Množstvo je povinné."),
  costCenterId: z.string().uuid("Vyber stredisko."),
  note: z.string().trim().optional(),
});

export async function inventurnaKorekciaAction(
  vstup: z.input<typeof korekciaSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = korekciaSchema.parse(vstup);
    const user = await getCurrentUser(db);

    const qty = normalizujQty(data.qty);
    try {
      await inventurnaKorekcia(db, {
        userId: user.id,
        lotId: data.lotId,
        qtyDelta: data.smer === "manko" ? `-${qty}` : qty,
        costCenterId: data.costCenterId,
        note: data.note || undefined,
      });
    } catch (e) {
      if (sqlState(e) === "23514") {
        throw new Error("Manko presahuje zostatok šarže.");
      }
      throw e;
    }

    revalidatePath(`/sklad/${data.materialId}`);
    revalidatePath("/sklad");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const cenovaKorekciaSchema = z.object({
  lotId: z.string().uuid(),
  materialId: z.string().uuid(),
  novaCenaEur: z.string().trim().min(1, "Nová cena je povinná."),
  note: z.string().trim().optional(),
});

export async function cenovaKorekciaAction(
  vstup: z.input<typeof cenovaKorekciaSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = cenovaKorekciaSchema.parse(vstup);
    const user = await getCurrentUser(db);

    await cenovaKorekcia(db, {
      userId: user.id,
      lotId: data.lotId,
      novaCena: parseEurPerUnitToPrice(data.novaCenaEur),
      note: data.note || undefined,
    });

    revalidatePath(`/sklad/${data.materialId}`);
    revalidatePath("/sklad");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const korekciaMaterialuSchema = z.object({
  materialId: z.string().uuid(),
  qty: z.string().trim().min(1, "Množstvo manka je povinné."),
  costCenterId: z.string().uuid("Vyber stredisko."),
  note: z.string().trim().optional(),
});

/** Inventúrne manko per materiál — odpis zo šarží vo FIFO poradí (D1). */
export async function inventurnaKorekciaMaterialuAction(
  vstup: z.input<typeof korekciaMaterialuSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = korekciaMaterialuSchema.parse(vstup);
    const user = await getCurrentUser(db);

    await inventurnaKorekciaMaterialu(db, {
      userId: user.id,
      materialId: data.materialId,
      qty: normalizujQty(data.qty, "Manko"),
      costCenterId: data.costCenterId,
      note: data.note || undefined,
    });

    revalidatePath(`/sklad/${data.materialId}`);
    revalidatePath("/sklad");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const polozkaPrijemkySchema = z.object({
  materialId: z.string().uuid("Vyber materiál."),
  qty: z.string().trim().min(1, "Množstvo je povinné."),
  cenaEur: z.string().trim().min(1, "Cena je povinná."),
  supplierLotCode: z.string().trim().optional(),
  /** párovanie šarže na konkrétny riadok faktúry (traceabilita) */
  invoiceItemId: z.string().uuid().optional(),
});

const prijemkaSchema = z.object({
  source: z.enum(["faktura", "pociatocny_stav"]),
  invoiceId: z.string().uuid().optional(),
  receivedAt: z.string().min(1, "Dátum príjmu je povinný."),
  note: z.string().trim().optional(),
  polozky: z
    .array(polozkaPrijemkySchema)
    .min(1, "Príjemka musí mať aspoň jednu položku."),
});

export async function vytvorPrijemkuAction(
  vstup: z.input<typeof prijemkaSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = prijemkaSchema.parse(vstup);
    if (data.source === "faktura" && !data.invoiceId) {
      throw new Error("Pri príjme z faktúry vyber faktúru.");
    }
    const user = await getCurrentUser(db);

    const polozky = data.polozky.map((p) => ({
      materialId: p.materialId,
      qty: normalizujQty(p.qty),
      unitPrice: parseEurPerUnitToPrice(p.cenaEur),
      supplierLotCode: p.supplierLotCode || undefined,
      invoiceItemId: p.invoiceItemId,
    }));

    // Číslo generuje systém; kolíziu pri súbehu (23505) rieši retry s novým číslom.
    const rok = Number(data.receivedAt.slice(0, 4));

    for (let pokus = 0; pokus < 3; pokus++) {
      const receiptNumber = await generujCisloPrijemky(db, rok);
      try {
        if (data.source === "faktura") {
          await prijemZoFaktury(db, {
            userId: user.id,
            receiptNumber,
            receivedAt: data.receivedAt,
            invoiceId: data.invoiceId!,
            note: data.note,
            polozky,
          });
        } else {
          await pociatocnyStav(db, {
            userId: user.id,
            receiptNumber,
            receivedAt: data.receivedAt,
            note: data.note,
            polozky,
          });
        }
        revalidatePath("/sklad");
        revalidatePath("/sklad/prijemky");
        return { ok: true };
      } catch (e) {
        if (sqlState(e) !== "23505") throw e;
      }
    }
    throw new Error(
      "Nepodarilo sa prideliť číslo príjemky (súbeh) — skús to prosím znova.",
    );
  } catch (e) {
    return naVysledok(e);
  }
}
