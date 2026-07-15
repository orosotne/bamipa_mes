"use server";

// Tenké server actions — validácia Zod, prod db + aktuálny user, revalidate.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { naVysledok, type VysledokAkcie } from "@/server/action-utils";
import { getCurrentUser } from "@/server/session";
import {
  createSupplier,
  softDeleteSupplier,
  updateSupplier,
} from "@/server/suppliers/service";

const dodavatelSchema = z.object({
  name: z.string().trim().min(1, "Názov dodávateľa je povinný."),
  ico: z.string().trim().optional(),
  dic: z.string().trim().optional(),
  icDph: z.string().trim().optional(),
  address: z.string().trim().optional(),
  email: z
    .string()
    .trim()
    .email("Neplatný e-mail.")
    .optional()
    .or(z.literal("")),
  phone: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

export async function vytvorDodavatelaAction(
  vstup: z.input<typeof dodavatelSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = dodavatelSchema.parse(vstup);
    const user = await getCurrentUser(db);
    await createSupplier(db, {
      userId: user.id,
      ...data,
      email: data.email || null,
    });
    revalidatePath("/dodavatelia");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function upravDodavatelaAction(
  id: string,
  vstup: z.input<typeof dodavatelSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = dodavatelSchema.parse(vstup);
    const user = await getCurrentUser(db);
    await updateSupplier(db, {
      userId: user.id,
      id,
      ...data,
      email: data.email || null,
    });
    revalidatePath("/dodavatelia");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function zmazDodavatelaAction(id: string): Promise<VysledokAkcie> {
  try {
    const user = await getCurrentUser(db);
    await softDeleteSupplier(db, { userId: user.id, id });
    revalidatePath("/dodavatelia");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}
