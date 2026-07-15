"use server";

// Správa používateľov (len admin). Prístup B: účet vzniká cez Supabase admin
// API (secret key, server-only), rola sa vedie v našej users tabuľke.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { naVysledok, type VysledokAkcie } from "@/server/action-utils";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { vyzadajRolu } from "@/server/session";
import {
  nastavAktivny,
  vytvorUsersZaznam,
  zmenRolu,
} from "@/server/users/service";

const rolaEnum = z.enum([
  "admin",
  "ekonom",
  "majster_valcovne",
  "laborant",
  "majster_lisovne",
]);

const novySchema = z.object({
  email: z.string().trim().email("Neplatný email."),
  displayName: z.string().trim().min(1, "Meno je povinné."),
  role: rolaEnum,
  heslo: z.string().min(8, "Dočasné heslo musí mať aspoň 8 znakov."),
});

export async function vytvorPouzivatelaAction(
  vstup: z.input<typeof novySchema>,
): Promise<VysledokAkcie> {
  try {
    const data = novySchema.parse(vstup);
    const admin = await vyzadajRolu(db); // len admin

    const sb = createSupabaseAdminClient();
    const { data: created, error } = await sb.auth.admin.createUser({
      email: data.email,
      password: data.heslo,
      email_confirm: true,
    });
    if (error || !created?.user) {
      throw new Error(
        `Vytvorenie auth účtu zlyhalo: ${error?.message ?? "neznáma chyba"}.`,
      );
    }

    await vytvorUsersZaznam(db, {
      adminId: admin.id,
      id: created.user.id,
      displayName: data.displayName,
      email: data.email,
      role: data.role,
    });

    revalidatePath("/pouzivatelia");
    return { ok: true, id: created.user.id };
  } catch (e) {
    return naVysledok(e);
  }
}

const zmenRoluSchema = z.object({ id: z.string().uuid(), role: rolaEnum });

export async function zmenRoluAction(
  vstup: z.input<typeof zmenRoluSchema>,
): Promise<VysledokAkcie> {
  try {
    const data = zmenRoluSchema.parse(vstup);
    const admin = await vyzadajRolu(db);
    await zmenRolu(db, { adminId: admin.id, id: data.id, role: data.role });
    revalidatePath("/pouzivatelia");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

const aktivnySchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });

export async function nastavAktivnyAction(
  vstup: z.input<typeof aktivnySchema>,
): Promise<VysledokAkcie> {
  try {
    const data = aktivnySchema.parse(vstup);
    const admin = await vyzadajRolu(db);
    await nastavAktivny(db, {
      adminId: admin.id,
      id: data.id,
      isActive: data.isActive,
    });
    revalidatePath("/pouzivatelia");
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}
