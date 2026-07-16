"use server";

// Tenké server actions pre M7 kalkulácie. Vzor M6: Zod parse → vyzadajRolu →
// služba → revalidatePath → VysledokAkcie. Uzávierku robí ekonóm (SPEC
// workflow 5); reopen a alokačné nastavenia len admin (SPEC §4).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { naVysledok, type VysledokAkcie } from "@/server/action-utils";
import { otvorMesiac, uzavriMesiac } from "@/server/calc/close";
import { ulozNastavenia } from "@/server/calc/settings";
import { dnesnyDatum, vyzadajRolu } from "@/server/session";

const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Neplatné obdobie (YYYY-MM-01).");

export async function uzavriMesiacAction(
  period: string,
): Promise<VysledokAkcie> {
  try {
    const p = periodSchema.parse(period);
    const user = await vyzadajRolu(db, "ekonom");
    await uzavriMesiac(db, { period: p, userId: user.id, dnes: dnesnyDatum() });
    revalidatePath("/kalkulacie");
    revalidatePath(`/kalkulacie/${p.slice(0, 7)}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function otvorMesiacAction(
  period: string,
): Promise<VysledokAkcie> {
  try {
    const p = periodSchema.parse(period);
    const user = await vyzadajRolu(db); // len admin
    await otvorMesiac(db, { period: p, userId: user.id });
    revalidatePath("/kalkulacie");
    revalidatePath(`/kalkulacie/${p.slice(0, 7)}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const nastaveniaSchema = z.object({
  valcovnaPct: z.coerce
    .number("Zadaj pomer valcovne.")
    .int("Pomer musí byť celé číslo.")
    .min(0, "Pomer musí byť 0–100.")
    .max(100, "Pomer musí byť 0–100."),
});

export async function ulozNastaveniaAction(
  vstup: z.input<typeof nastaveniaSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = nastaveniaSchema.parse(vstup);
    const user = await vyzadajRolu(db); // len admin (alokačné kľúče, SPEC §4)
    await ulozNastavenia(db, {
      userId: user.id,
      energyValcovnaPct: data.valcovnaPct,
    });
    revalidatePath("/kalkulacie/nastavenia");
    revalidatePath("/kalkulacie");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}
