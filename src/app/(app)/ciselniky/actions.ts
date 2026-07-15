"use server";

// Tenké server actions pre M4 číselníky (stroje, pracovníci, sadzby).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { parseEurToCents } from "@/lib/format";
import { naVysledok, type VysledokAkcie } from "@/server/action-utils";
import {
  createMachine,
  softDeleteMachine,
  updateMachine,
} from "@/server/machines/service";
import { vyzadajRolu } from "@/server/session";
import {
  createWorker,
  pridajSadzbu,
  softDeleteWorker,
  updateWorker,
} from "@/server/workers/service";

const strojSchema = z.object({
  code: z.string().trim().min(1, "Kód stroja je povinný."),
  name: z.string().trim().min(1, "Názov stroja je povinný."),
  costCenterId: z.string().uuid("Vyber stredisko."),
  isActive: z.boolean().default(true),
});

export async function ulozStrojAction(
  id: string | null,
  vstup: z.input<typeof strojSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = strojSchema.parse(vstup);
    const user = await vyzadajRolu(db);
    if (id) {
      await updateMachine(db, { userId: user.id, id, ...data });
    } else {
      await createMachine(db, { userId: user.id, ...data });
    }
    revalidatePath("/ciselniky");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function zmazStrojAction(id: string): Promise<VysledokAkcie> {
  try {
    const user = await vyzadajRolu(db);
    await softDeleteMachine(db, { userId: user.id, id });
    revalidatePath("/ciselniky");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const pracovnikSchema = z.object({
  fullName: z.string().trim().min(1, "Meno pracovníka je povinné."),
  isActive: z.boolean().default(true),
});

export async function ulozPracovnikaAction(
  id: string | null,
  vstup: z.input<typeof pracovnikSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = pracovnikSchema.parse(vstup);
    const user = await vyzadajRolu(db);
    if (id) {
      await updateWorker(db, { userId: user.id, id, ...data });
    } else {
      await createWorker(db, { userId: user.id, ...data });
    }
    revalidatePath("/ciselniky");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function zmazPracovnikaAction(id: string): Promise<VysledokAkcie> {
  try {
    const user = await vyzadajRolu(db);
    await softDeleteWorker(db, { userId: user.id, id });
    revalidatePath("/ciselniky");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const sadzbaSchema = z.object({
  workerId: z.string().uuid(),
  hodinovkaEur: z.string().trim().min(1, "Sadzba je povinná."),
  validFrom: z.string().min(1, "Dátum platnosti je povinný."),
});

export async function pridajSadzbuAction(
  vstup: z.input<typeof sadzbaSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = sadzbaSchema.parse(vstup);
    const user = await vyzadajRolu(db);
    await pridajSadzbu(db, {
      userId: user.id,
      workerId: data.workerId,
      hourlyRateCents: parseEurToCents(data.hodinovkaEur),
      validFrom: data.validFrom,
    });
    revalidatePath("/ciselniky");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}
