"use server";

// Server actions pre D10 CSV importy číselníkov. Len admin (vyzadajRolu bez
// rolí). Rovnaká akcia beží dry-run kontrolu aj ostrý import — server pri
// potvrdení vždy znovu validuje (medzi kontrolou a importom sa DB mohla zmeniť).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { naVysledok } from "@/server/action-utils";
import { importujArtikle } from "@/server/import/artikle";
import type { ImportChyba } from "@/server/import/csv";
import { importujDodavatelov } from "@/server/import/dodavatelia";
import { importujMaterialy } from "@/server/import/materialy";
import { importujReceptury } from "@/server/import/receptury";
import type { ImportPrehlad } from "@/server/import/typy";
import { vyzadajRolu } from "@/server/session";

const MAX_VELKOST_B = 1_000_000; // 1 MB — číselníky, nie datové dumpy

const vstupSchema = z.object({
  typ: z.enum(["dodavatelia", "materialy", "receptury", "artikle"]),
  aktualizovat: z.boolean(),
});

export type ImportTyp = z.infer<typeof vstupSchema>["typ"];

export type ImportAkciaVysledok =
  | { ok: true; chyby: ImportChyba[]; prehlad: ImportPrehlad }
  | { ok: false; error: string };

const IMPORTY = {
  dodavatelia: importujDodavatelov,
  materialy: importujMaterialy,
  receptury: importujReceptury,
  artikle: importujArtikle,
} as const;

// Import mení dáta naprieč modulmi — invaliduj dotknuté prehľady.
const CESTY_PODLA_TYPU: Record<ImportTyp, string[]> = {
  dodavatelia: ["/dodavatelia"],
  materialy: ["/sklad", "/dodavatelia"],
  receptury: ["/receptury", "/sklad"],
  artikle: ["/lisovna"],
};

export async function importCsvAction(
  dryRun: boolean,
  formData: FormData,
): Promise<ImportAkciaVysledok> {
  try {
    const user = await vyzadajRolu(db); // len admin

    const data = vstupSchema.parse({
      typ: formData.get("typ"),
      aktualizovat: formData.get("aktualizovat") === "true",
    });
    const subor = formData.get("subor");
    if (!(subor instanceof File) || subor.size === 0) {
      return { ok: false, error: "Vyber CSV súbor." };
    }
    if (subor.size > MAX_VELKOST_B) {
      return {
        ok: false,
        error: "Súbor je väčší ako 1 MB — číselníky rozdeľ na menšie časti.",
      };
    }

    // Blob.text() dekóduje vždy UTF-8 — Windows-1250 export z Excelu by ticho
    // doniesol mojibake (U+FFFD namiesto diakritiky). Radšej zrozumiteľná chyba.
    const text = await subor.text();
    if (text.includes("�")) {
      return {
        ok: false,
        error:
          "Súbor nie je v kódovaní UTF-8 — v Exceli použi „Uložiť ako → CSV UTF-8 (oddelený čiarkami)“ a nahraj ho znova.",
      };
    }

    const vysledok = await IMPORTY[data.typ](db, {
      userId: user.id,
      text,
      rezim: data.aktualizovat ? "aktualizovat" : "len_nove",
      dryRun,
      nazovSuboru: subor.name,
    });

    if (!dryRun && vysledok.chyby.length === 0) {
      for (const cesta of CESTY_PODLA_TYPU[data.typ]) {
        revalidatePath(cesta);
      }
    }
    return { ok: true, ...vysledok };
  } catch (e) {
    return naVysledok(e) as ImportAkciaVysledok;
  }
}
