"use server";

// Tenké server actions pre M4 výrobu (dávky valcovne).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  naVysledok,
  normalizujQty,
  sqlState,
  type VysledokAkcie,
} from "@/server/action-utils";
import {
  aktualizujCasy,
  odovzdajNaLabak,
  pridajPracu,
  pridajPrestoj,
  vydajNavazkuDavky,
  zalozDavku,
  zmazPrestoj,
} from "@/server/batches/service";
import { generujCisloDavky } from "@/server/batches/numbering";
import { stornoVydaja } from "@/server/inventory/corrections";
import { vyzadajRolu } from "@/server/session";

const novaDavkaSchema = z.object({
  mixtureId: z.string().uuid("Vyber zmes."),
  productionDate: z.string().min(1, "Dátum výroby je povinný."),
  shift: z.enum(["ranna", "poobedna", "nocna"]),
  machineId: z.string().uuid("Vyber stroj."),
  leadWorkerId: z.string().uuid("Vyber obsluhu."),
  scaleFactor: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

export async function zalozDavkuAction(
  vstup: z.input<typeof novaDavkaSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = novaDavkaSchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_valcovne");
    const rok = Number(data.productionDate.slice(0, 4));
    const scaleFactor = data.scaleFactor
      ? normalizujQty(data.scaleFactor, "Násobok dávky")
      : undefined;

    for (let pokus = 0; pokus < 3; pokus++) {
      const batchNumber = await generujCisloDavky(db, rok);
      try {
        const davka = await zalozDavku(db, {
          userId: user.id,
          batchNumber,
          mixtureId: data.mixtureId,
          productionDate: data.productionDate,
          shift: data.shift,
          machineId: data.machineId,
          leadWorkerId: data.leadWorkerId,
          scaleFactor,
          note: data.note || undefined,
        });
        revalidatePath("/vyroba");
        return { ok: true, id: davka.id };
      } catch (e) {
        if (sqlState(e) !== "23505") throw e;
      }
    }
    throw new Error(
      "Nepodarilo sa prideliť číslo dávky (súbeh) — skús to prosím znova.",
    );
  } catch (e) {
    return naVysledok(e);
  }
}

const polozkaNavazkySchema = z.object({
  materialId: z.string().uuid(),
  qty: z.string().trim().min(1, "Množstvo je povinné."),
});

const vydajSchema = z.object({
  batchId: z.string().uuid(),
  polozky: z.array(polozkaNavazkySchema).min(1, "Navážka musí mať položky."),
});

export async function vydajNavazkuAction(
  vstup: z.input<typeof vydajSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = vydajSchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_valcovne");
    await vydajNavazkuDavky(db, {
      userId: user.id,
      batchId: data.batchId,
      polozky: data.polozky.map((p) => ({
        materialId: p.materialId,
        qty: normalizujQty(p.qty),
      })),
    });
    revalidatePath(`/vyroba/${data.batchId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function stornoVydajaBatchAction(vstup: {
  moveId: string;
  batchId: string;
}): Promise<VysledokAkcie> {
  try {
    const user = await vyzadajRolu(db, "majster_valcovne");
    await stornoVydaja(db, { userId: user.id, moveId: vstup.moveId });
    revalidatePath(`/vyroba/${vstup.batchId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const pracaSchema = z.object({
  batchId: z.string().uuid(),
  workerId: z.string().uuid("Vyber pracovníka."),
  workDate: z.string().min(1, "Dátum je povinný."),
  hours: z.string().trim().min(1, "Hodiny sú povinné."),
});

export async function pridajPracuAction(
  vstup: z.input<typeof pracaSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = pracaSchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_valcovne");
    await pridajPracu(db, {
      userId: user.id,
      batchId: data.batchId,
      workerId: data.workerId,
      workDate: data.workDate,
      hours: data.hours.trim().replace(",", "."),
    });
    revalidatePath(`/vyroba/${data.batchId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const prestojSchema = z.object({
  batchId: z.string().uuid(),
  reasonId: z.string().uuid("Vyber dôvod."),
  minutes: z.coerce.number().int().positive("Minúty musia byť kladné celé číslo."),
  note: z.string().trim().optional(),
});

export async function pridajPrestojAction(
  vstup: z.input<typeof prestojSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = prestojSchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_valcovne");
    await pridajPrestoj(db, {
      userId: user.id,
      batchId: data.batchId,
      reasonId: data.reasonId,
      minutes: data.minutes,
      note: data.note || undefined,
    });
    revalidatePath(`/vyroba/${data.batchId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function zmazPrestojAction(vstup: {
  id: string;
  batchId: string;
}): Promise<VysledokAkcie> {
  try {
    const user = await vyzadajRolu(db, "majster_valcovne");
    await zmazPrestoj(db, { userId: user.id, id: vstup.id });
    revalidatePath(`/vyroba/${vstup.batchId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const casySchema = z.object({
  batchId: z.string().uuid(),
  workMinutes: z.coerce
    .number()
    .int()
    .positive("Čas musí byť kladné celé číslo minút."),
});

export async function aktualizujCasyAction(
  vstup: z.input<typeof casySchema>,
): Promise<VysledokAkcie> {
  try {
    const data = casySchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_valcovne");
    await aktualizujCasy(db, {
      userId: user.id,
      batchId: data.batchId,
      workMinutes: data.workMinutes,
    });
    revalidatePath(`/vyroba/${data.batchId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const odovzdajSchema = z.object({
  batchId: z.string().uuid(),
  outputKg: z.string().trim().min(1, "Skutočná výroba (kg) je povinná."),
});

export async function odovzdajNaLabakAction(
  vstup: z.input<typeof odovzdajSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = odovzdajSchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_valcovne");
    await odovzdajNaLabak(db, {
      userId: user.id,
      batchId: data.batchId,
      outputKg: normalizujQty(data.outputKg, "Skutočná výroba"),
    });
    revalidatePath(`/vyroba/${data.batchId}`);
    revalidatePath("/vyroba");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}
