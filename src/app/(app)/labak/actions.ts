"use server";

// Tenké server actions pre M5 labák (meranie + verdikt). Validácia vstupu Zod,
// doménová logika a stavový automat v službe (src/server/lab/service.ts).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { naVysledok, type VysledokAkcie } from "@/server/action-utils";
import { vynesVerdikt, zapisMerania } from "@/server/lab/service";
import { vyzadajRolu } from "@/server/session";

const meraniaSchema = z.object({
  batchId: z.string().uuid(),
  merania: z
    .array(
      z.object({
        parameterId: z.string().uuid(),
        value: z.string().trim().min(1, "Zadaj nameranú hodnotu."),
      }),
    )
    .min(1, "Meranie musí obsahovať aspoň jeden parameter."),
  note: z.string().trim().optional(),
});

export async function zapisMeraniaAction(
  vstup: z.input<typeof meraniaSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = meraniaSchema.parse(vstup);
    const user = await vyzadajRolu(db, "laborant");
    const { test } = await zapisMerania(db, {
      userId: user.id,
      batchId: data.batchId,
      merania: data.merania,
      note: data.note || undefined,
    });
    revalidatePath(`/labak/${data.batchId}`);
    revalidatePath("/labak");
    return { ok: true, id: test.id };
  } catch (e) {
    return naVysledok(e);
  }
}

const verdiktSchema = z.object({
  labTestId: z.string().uuid(),
  batchId: z.string().uuid(),
  verdict: z.enum(["schvalene", "zamietnute"]),
  instrukcia: z.string().trim().optional(),
});

export async function vynesVerdiktAction(
  vstup: z.input<typeof verdiktSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = verdiktSchema.parse(vstup);
    const user = await vyzadajRolu(db, "laborant");
    await vynesVerdikt(db, {
      userId: user.id,
      labTestId: data.labTestId,
      verdict: data.verdict,
      instrukcia: data.instrukcia || undefined,
    });
    revalidatePath(`/labak/${data.batchId}`);
    revalidatePath("/labak");
    revalidatePath(`/vyroba/${data.batchId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}
