"use server";

// Tenké server actions pre M6 lisovňu (artikle, príkazy, výkony, expedícia).
// Vzor M4: Zod parse → vyzadajRolu → služba → revalidatePath → VysledokAkcie.
// Artikel mutácie sú len admin (predajná cena); ostatné majster_lisovne.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { parseEurToCents } from "@/lib/format";
import {
  naVysledok,
  normalizujQty,
  type VysledokAkcie,
} from "@/server/action-utils";
import {
  softDeleteArtikel,
  updateArtikel,
  vytvorArtikel,
} from "@/server/press/articles";
import { zapisPracu, zmazPracu } from "@/server/press/labor";
import {
  dokonciPrikaz,
  otvorPrikaz,
  zalozPrikaz,
  zrusPrikaz,
} from "@/server/press/orders";
import { stornoVykon, zapisVykon } from "@/server/press/runs";
import { zapisOrez, zmazOrez } from "@/server/press/scrap";
import {
  stornoDodaciList,
  vytvorDodaciList,
} from "@/server/press/shipments";
import { vyzadajRolu } from "@/server/session";

// ── artikle (mutácie len admin) ──

const artikelSchema = z.object({
  code: z.string().trim().min(1, "Kód artikla je povinný."),
  name: z.string().trim().min(1, "Názov artikla je povinný."),
  mixtureId: z.string().uuid("Vyber zmes."),
  mixtureKgPerPair: z.string().trim().min(1, "Norma spotreby je povinná."),
  targetCycleSeconds: z.string().trim().optional(),
  salePriceEur: z.string().trim().optional(),
  isActive: z.boolean().default(true),
});

export async function ulozArtikelAction(
  id: string | null,
  vstup: z.input<typeof artikelSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = artikelSchema.parse(vstup);
    const user = await vyzadajRolu(db);

    const mixtureKgPerPair = normalizujQty(
      data.mixtureKgPerPair,
      "Norma spotreby",
    );
    let targetCycleSeconds: number | null = null;
    if (data.targetCycleSeconds) {
      targetCycleSeconds = Number(data.targetCycleSeconds);
      if (!Number.isInteger(targetCycleSeconds) || targetCycleSeconds <= 0) {
        throw new Error("Cieľový čas cyklu musí byť kladné celé číslo sekúnd.");
      }
    }
    const salePriceCents = data.salePriceEur
      ? parseEurToCents(data.salePriceEur)
      : null;

    const polia = {
      code: data.code,
      name: data.name,
      mixtureId: data.mixtureId,
      mixtureKgPerPair,
      targetCycleSeconds,
      salePriceCents,
      isActive: data.isActive,
    };
    if (id) {
      await updateArtikel(db, { userId: user.id, id, ...polia });
    } else {
      await vytvorArtikel(db, { userId: user.id, ...polia });
    }
    revalidatePath("/lisovna/artikle");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function zmazArtikelAction(id: string): Promise<VysledokAkcie> {
  try {
    const user = await vyzadajRolu(db);
    await softDeleteArtikel(db, { userId: user.id, id });
    revalidatePath("/lisovna/artikle");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

// ── výrobné príkazy ──

const novyPrikazSchema = z.object({
  soleModelId: z.string().uuid("Vyber artikel."),
  qtyPairsPlanned: z.coerce
    .number("Zadaj množstvo párov.")
    .int("Množstvo párov musí byť celé číslo.")
    .positive("Množstvo párov musí byť kladné."),
  prepBranch: z.enum(["barwell", "sekanie"]).nullable().optional(),
  note: z.string().trim().optional(),
});

export async function zalozPrikazAction(
  vstup: z.input<typeof novyPrikazSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = novyPrikazSchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_lisovne");
    const prikaz = await zalozPrikaz(db, {
      userId: user.id,
      soleModelId: data.soleModelId,
      qtyPairsPlanned: data.qtyPairsPlanned,
      prepBranch: data.prepBranch ?? null,
      note: data.note || undefined,
    });
    revalidatePath("/lisovna");
    return { ok: true, id: prikaz.id };
  } catch (e) {
    return naVysledok(e);
  }
}

async function zmenaStavuAction(
  id: string,
  sluzba: typeof dokonciPrikaz,
): Promise<VysledokAkcie> {
  try {
    const user = await vyzadajRolu(db, "majster_lisovne");
    await sluzba(db, { userId: user.id, id });
    revalidatePath(`/lisovna/${id}`);
    revalidatePath("/lisovna");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function dokonciPrikazAction(id: string): Promise<VysledokAkcie> {
  return zmenaStavuAction(id, dokonciPrikaz);
}
export async function otvorPrikazAction(id: string): Promise<VysledokAkcie> {
  return zmenaStavuAction(id, otvorPrikaz);
}
export async function zrusPrikazAction(id: string): Promise<VysledokAkcie> {
  return zmenaStavuAction(id, zrusPrikaz);
}

// ── výkony ──

const vykonSchema = z.object({
  workOrderId: z.string().uuid(),
  machineId: z.string().uuid("Vyber lis."),
  batchId: z.string().uuid("Vyber dávku zmesi."),
  runDate: z.string().min(1, "Dátum je povinný."),
  shift: z.enum(["ranna", "poobedna", "nocna"]),
  cyclesCount: z.coerce
    .number("Zadaj počet cyklov.")
    .int("Počet cyklov musí byť celé číslo.")
    .positive("Počet cyklov musí byť kladný."),
  pairsProduced: z.coerce
    .number("Zadaj vyrobené páry.")
    .int("Vyrobené páry musia byť celé číslo.")
    .min(0, "Vyrobené páry nesmú byť záporné."),
  mixtureKg: z.string().trim().min(1, "Spotreba zmesi je povinná."),
  workerId: z.string().uuid("Vyber obsluhu."),
  note: z.string().trim().optional(),
  nepodarky: z
    .array(
      z.object({
        defectReasonId: z.string().uuid("Vyber dôvod nepodarku."),
        qtyPairs: z.coerce
          .number("Zadaj počet nepodarkov.")
          .int("Počet nepodarkov musí byť celé číslo.")
          .positive("Počet nepodarkov musí byť kladný."),
      }),
    )
    .default([]),
  prestoje: z
    .array(
      z.object({
        reasonId: z.string().uuid("Vyber dôvod prestoja."),
        minutes: z.coerce
          .number("Zadaj minúty prestoja.")
          .int("Minúty prestoja musia byť celé číslo.")
          .positive("Minúty prestoja musia byť kladné."),
        note: z.string().trim().optional(),
      }),
    )
    .default([]),
});

export async function zapisVykonAction(
  vstup: z.input<typeof vykonSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = vykonSchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_lisovne");
    const mixtureKg = normalizujQty(data.mixtureKg, "Spotreba zmesi");
    const { run } = await zapisVykon(db, {
      userId: user.id,
      workOrderId: data.workOrderId,
      machineId: data.machineId,
      batchId: data.batchId,
      runDate: data.runDate,
      shift: data.shift,
      cyclesCount: data.cyclesCount,
      pairsProduced: data.pairsProduced,
      mixtureKg,
      workerId: data.workerId,
      note: data.note || undefined,
      nepodarky: data.nepodarky,
      prestoje: data.prestoje.map((p) => ({
        ...p,
        note: p.note || undefined,
      })),
    });
    revalidatePath(`/lisovna/${data.workOrderId}`);
    revalidatePath("/lisovna");
    return { ok: true, id: run.id };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function stornoVykonAction(vstup: {
  id: string;
  workOrderId: string;
}): Promise<VysledokAkcie> {
  try {
    const user = await vyzadajRolu(db, "majster_lisovne");
    await stornoVykon(db, { userId: user.id, id: vstup.id });
    revalidatePath(`/lisovna/${vstup.workOrderId}`);
    revalidatePath("/lisovna");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

// ── práca ──

const pracaSchema = z.object({
  workOrderId: z.string().uuid(),
  workerId: z.string().uuid("Vyber pracovníka."),
  workDate: z.string().min(1, "Dátum je povinný."),
  hours: z.string().trim().min(1, "Zadaj hodiny."),
});

export async function zapisPracuAction(
  vstup: z.input<typeof pracaSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = pracaSchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_lisovne");
    const hours = normalizujQty(data.hours, "Hodiny");
    await zapisPracu(db, {
      userId: user.id,
      workOrderId: data.workOrderId,
      workerId: data.workerId,
      workDate: data.workDate,
      hours,
    });
    revalidatePath(`/lisovna/${data.workOrderId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function zmazPracuAction(vstup: {
  id: string;
  workOrderId: string;
}): Promise<VysledokAkcie> {
  try {
    const user = await vyzadajRolu(db, "majster_lisovne");
    await zmazPracu(db, { userId: user.id, id: vstup.id });
    revalidatePath(`/lisovna/${vstup.workOrderId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

// ── orez / pretoky ──

const orezSchema = z.object({
  workOrderId: z.string().uuid(),
  qtyKg: z.string().trim().min(1, "Zadaj hmotnosť odpadu."),
  recordDate: z.string().min(1, "Dátum je povinný."),
  note: z.string().trim().optional(),
});

export async function zapisOrezAction(
  vstup: z.input<typeof orezSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = orezSchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_lisovne");
    const qtyKg = normalizujQty(data.qtyKg, "Hmotnosť odpadu");
    await zapisOrez(db, {
      userId: user.id,
      workOrderId: data.workOrderId,
      qtyKg,
      recordDate: data.recordDate,
      note: data.note || undefined,
    });
    revalidatePath(`/lisovna/${data.workOrderId}`);
    revalidatePath("/lisovna");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function zmazOrezAction(vstup: {
  id: string;
  workOrderId: string;
}): Promise<VysledokAkcie> {
  try {
    const user = await vyzadajRolu(db, "majster_lisovne");
    await zmazOrez(db, { userId: user.id, id: vstup.id });
    revalidatePath(`/lisovna/${vstup.workOrderId}`);
    revalidatePath("/lisovna");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

// ── expedícia ──

const dodaciSchema = z.object({
  shipDate: z.string().min(1, "Dátum expedície je povinný."),
  customer: z.string().trim().min(1, "Odberateľ je povinný."),
  note: z.string().trim().optional(),
  polozky: z
    .array(
      z.object({
        workOrderId: z.string().uuid("Vyber výrobný príkaz."),
        qtyPairs: z.coerce
          .number("Zadaj počet párov.")
          .int("Počet párov musí byť celé číslo.")
          .positive("Počet párov musí byť kladný."),
      }),
    )
    .min(1, "Dodací list musí obsahovať aspoň jednu položku."),
});

export async function vytvorDodaciListAction(
  vstup: z.input<typeof dodaciSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = dodaciSchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_lisovne");
    const { shipment } = await vytvorDodaciList(db, {
      userId: user.id,
      shipDate: data.shipDate,
      customer: data.customer,
      note: data.note || undefined,
      polozky: data.polozky,
    });
    revalidatePath("/lisovna/expedicia");
    revalidatePath("/lisovna");
    return { ok: true, id: shipment.id };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function stornoDodaciListAction(
  id: string,
): Promise<VysledokAkcie> {
  try {
    const user = await vyzadajRolu(db, "majster_lisovne");
    await stornoDodaciList(db, { userId: user.id, id });
    revalidatePath("/lisovna/expedicia");
    revalidatePath("/lisovna");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}
