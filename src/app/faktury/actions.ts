"use server";

// Tenké server actions pre M1 faktúry — Zod validácia, konverzia EUR → centy,
// volanie služieb s prod db + aktuálnym userom.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { parseEurToCents } from "@/lib/format";
import { naVysledok, type VysledokAkcie } from "@/server/action-utils";
import {
  createInvoice,
  pridatPlatbu,
  schvalitFakturu,
} from "@/server/invoices/service";
import { getCurrentUser } from "@/server/session";

const sumaEur = z
  .string()
  .trim()
  .min(1, "Suma je povinná.")
  .refine((v) => {
    try {
      parseEurToCents(v);
      return true;
    } catch {
      return false;
    }
  }, "Neplatná suma (očakávam napr. 1 234,56).");

const polozkaSchema = z.object({
  description: z.string().trim().min(1, "Popis položky je povinný."),
  category: z.enum(["material", "energia", "sluzby", "investicia", "rezia"]),
  costCenterId: z.string().uuid("Vyber stredisko."),
  sumaNetEur: sumaEur,
});

const fakturaSchema = z.object({
  supplierId: z.string().uuid("Vyber dodávateľa."),
  invoiceNumber: z.string().trim().min(1, "Číslo faktúry je povinné."),
  issueDate: z.string().optional(),
  deliveryDate: z.string().optional(),
  dueDate: z.string().min(1, "Dátum splatnosti je povinný."),
  sumaNetEur: sumaEur,
  sumaVatEur: sumaEur,
  note: z.string().optional(),
  polozky: z.array(polozkaSchema).min(1, "Faktúra musí mať aspoň jednu položku."),
});

export type VstupFakturyForm = z.input<typeof fakturaSchema>;

export async function vytvorFakturuAction(
  vstup: VstupFakturyForm,
): Promise<VysledokAkcie> {
  try {
    const data = fakturaSchema.parse(vstup);
    const user = await getCurrentUser(db);

    const totalNetCents = parseEurToCents(data.sumaNetEur);
    const totalVatCents = parseEurToCents(data.sumaVatEur);

    const { invoice } = await createInvoice(db, {
      userId: user.id,
      supplierId: data.supplierId,
      invoiceNumber: data.invoiceNumber,
      issueDate: data.issueDate || null,
      deliveryDate: data.deliveryDate || null,
      dueDate: data.dueDate,
      totalNetCents,
      totalVatCents,
      totalGrossCents: totalNetCents + totalVatCents,
      note: data.note || null,
      polozky: data.polozky.map((p) => ({
        description: p.description,
        category: p.category,
        costCenterId: p.costCenterId,
        totalNetCents: parseEurToCents(p.sumaNetEur),
      })),
    });

    revalidatePath("/faktury");
    return { ok: true, id: invoice.id };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function schvalFakturuAction(id: string): Promise<VysledokAkcie> {
  try {
    const user = await getCurrentUser(db);
    await schvalitFakturu(db, { userId: user.id, id });
    revalidatePath("/faktury");
    revalidatePath(`/faktury/${id}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}

export async function pridajPlatbuAction(vstup: {
  invoiceId: string;
  paidAt: string;
  sumaEur: string;
}): Promise<VysledokAkcie> {
  try {
    const user = await getCurrentUser(db);
    await pridatPlatbu(db, {
      userId: user.id,
      invoiceId: vstup.invoiceId,
      paidAt: vstup.paidAt,
      amountCents: parseEurToCents(vstup.sumaEur),
    });
    revalidatePath("/faktury");
    revalidatePath(`/faktury/${vstup.invoiceId}`);
    return { ok: true };
  } catch (e) {
    return naVysledok(e);
  }
}
