"use server";

// Tenké server actions pre M3 receptúry.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  naVysledok,
  normalizujQty,
  type VysledokAkcie,
} from "@/server/action-utils";
import { ulozLimit } from "@/server/lab/definitions";
import {
  aktivujVerziu,
  createMixture,
  createRecipeVersion,
  softDeleteMixture,
  updateMixture,
} from "@/server/mixtures/service";
import { getCurrentUser } from "@/server/session";

const zmesSchema = z.object({
  code: z.string().trim().min(1, "Kód zmesi je povinný."),
  name: z.string().trim().min(1, "Názov zmesi je povinný."),
  note: z.string().trim().optional(),
});

export async function ulozZmesAction(
  id: string | null,
  vstup: z.input<typeof zmesSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = zmesSchema.parse(vstup);
    const user = await getCurrentUser(db);
    const zmes = id
      ? await updateMixture(db, { userId: user.id, id, ...data })
      : await createMixture(db, { userId: user.id, ...data });
    revalidatePath("/receptury");
    return { ok: true, id: zmes.id };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function zmazZmesAction(id: string): Promise<VysledokAkcie> {
  try {
    const user = await getCurrentUser(db);
    await softDeleteMixture(db, { userId: user.id, id });
    revalidatePath("/receptury");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const verziaSchema = z.object({
  mixtureId: z.string().uuid(),
  standardBatchKg: z.string().trim().min(1, "Štandardná dávka je povinná."),
  techNotes: z.string().trim().optional(),
  polozky: z
    .array(
      z.object({
        materialId: z.string().uuid("Vyber materiál."),
        qtyKg: z.string().trim().min(1, "Množstvo je povinné."),
      }),
    )
    .min(1, "Receptúra musí mať aspoň jednu položku."),
});

export async function vytvorVerziuAction(
  vstup: z.input<typeof verziaSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = verziaSchema.parse(vstup);
    const user = await getCurrentUser(db);

    await createRecipeVersion(db, {
      userId: user.id,
      mixtureId: data.mixtureId,
      standardBatchKg: normalizujQty(data.standardBatchKg, "Štandardná dávka"),
      techNotes: data.techNotes || null,
      polozky: data.polozky.map((p) => ({
        materialId: p.materialId,
        qtyKg: normalizujQty(p.qtyKg),
      })),
    });

    revalidatePath(`/receptury/${data.mixtureId}`);
    revalidatePath("/receptury");
    return { ok: true, id: data.mixtureId };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function aktivujVerziuAction(
  mixtureId: string,
  recipeId: string,
): Promise<VysledokAkcie> {
  try {
    const user = await getCurrentUser(db);
    await aktivujVerziu(db, { userId: user.id, recipeId });
    revalidatePath(`/receptury/${mixtureId}`);
    revalidatePath("/receptury");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

// M5 Labák — tolerančné limity per zmes (lab_test_definitions).
const limitSchema = z.object({
  mixtureId: z.string().uuid(),
  parameterId: z.string().uuid(),
  minValue: z.string().trim().optional(),
  maxValue: z.string().trim().optional(),
});

export async function ulozLimitAction(
  vstup: z.input<typeof limitSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = limitSchema.parse(vstup);
    const user = await getCurrentUser(db);
    await ulozLimit(db, {
      userId: user.id,
      mixtureId: data.mixtureId,
      parameterId: data.parameterId,
      minValue: data.minValue ?? null,
      maxValue: data.maxValue ?? null,
    });
    revalidatePath(`/receptury/${data.mixtureId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}
