"use server";

// M5 Labák — rework (úprava dávky po zamietnutí). Majster valcovne dopĺňa dávku:
// dodatočný výdaj materiálu a práca s väzbou na adjustment_id (vícenáklady sa
// kumulujú na dávke, v_batch_costs ich vedie ako rework). Znovu odovzdanie na
// labák beží cez existujúcu odovzdajNaLabakAction.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  naVysledok,
  normalizujQty,
  type VysledokAkcie,
} from "@/server/action-utils";
import { pridajPracu, vydajNavazkuDavky } from "@/server/batches/service";
import { vyzadajRolu } from "@/server/session";

const vydajReworkSchema = z.object({
  batchId: z.string().uuid(),
  adjustmentId: z.string().uuid(),
  materialId: z.string().uuid("Vyber materiál."),
  qty: z.string().trim().min(1, "Množstvo je povinné."),
});

export async function vydajReworkAction(
  vstup: z.input<typeof vydajReworkSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = vydajReworkSchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_valcovne");
    await vydajNavazkuDavky(db, {
      userId: user.id,
      batchId: data.batchId,
      polozky: [{ materialId: data.materialId, qty: normalizujQty(data.qty) }],
      adjustmentId: data.adjustmentId,
    });
    revalidatePath(`/vyroba/${data.batchId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const pracaReworkSchema = z.object({
  batchId: z.string().uuid(),
  adjustmentId: z.string().uuid(),
  workerId: z.string().uuid("Vyber pracovníka."),
  workDate: z.string().min(1, "Dátum je povinný."),
  hours: z.string().trim().min(1, "Hodiny sú povinné."),
});

export async function pridajPracuReworkAction(
  vstup: z.input<typeof pracaReworkSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = pracaReworkSchema.parse(vstup);
    const user = await vyzadajRolu(db, "majster_valcovne");
    await pridajPracu(db, {
      userId: user.id,
      batchId: data.batchId,
      workerId: data.workerId,
      workDate: data.workDate,
      hours: data.hours.trim().replace(",", "."),
      adjustmentId: data.adjustmentId,
    });
    revalidatePath(`/vyroba/${data.batchId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}
