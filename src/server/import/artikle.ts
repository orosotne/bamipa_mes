// D10 import artiklov podošiev (sole_models). Kľúč zhody = kod; zmes sa
// referencuje kódom (musí existovať). Cena v € s desatinnou čiarkou → centy.
import { isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { parseEurToCents } from "@/lib/format";
import { normalizujQty } from "@/server/action-utils";
import { updateArtikel, vytvorArtikel } from "@/server/press/articles";
import { domenovaSprava, ImportRiadokChyba, zapisAuditImportu } from "./audit";
import { type ImportChyba, parseCsv } from "./csv";
import { spustiImport } from "./spustenie";
import {
  type ImportVstup,
  type ImportVysledok,
  PRAZDNY_PREHLAD,
} from "./typy";

const STLPCE = {
  povinne: ["kod", "nazov", "kod_zmesi", "norma_kg_na_par"],
  volitelne: ["cielovy_cas_cyklu_s", "predajna_cena_eur"],
} as const;

type Zaznam = {
  riadok: number;
  kod: string;
  nazov: string;
  kodZmesi: string;
  /** numeric(12,3) string */
  normaKg: string;
  cyklusS: number | null;
  cenaCenty: number | null;
};

export async function importujArtikle(
  db: DbClient,
  vstup: ImportVstup,
): Promise<ImportVysledok> {
  const { riadky, chyby: chybyCsv } = parseCsv(vstup.text, STLPCE);
  if (chybyCsv.length > 0) {
    return { chyby: chybyCsv, prehlad: PRAZDNY_PREHLAD };
  }

  // ── validácia polí + duplicity v súbore ──
  const chyby: ImportChyba[] = [];
  const zaznamy: Zaznam[] = [];
  const prveVyskyty = new Map<string, number>();
  for (const r of riadky) {
    const kod = r.polia.kod;
    if (kod === "") {
      chyby.push({ riadok: r.cislo, stlpec: "kod", sprava: "Kód artikla je povinný." });
      continue;
    }
    if (r.polia.nazov === "") {
      chyby.push({ riadok: r.cislo, stlpec: "nazov", sprava: "Názov artikla je povinný." });
      continue;
    }
    if (r.polia.kod_zmesi === "") {
      chyby.push({ riadok: r.cislo, stlpec: "kod_zmesi", sprava: "Kód zmesi je povinný." });
      continue;
    }
    const prvy = prveVyskyty.get(kod);
    if (prvy !== undefined) {
      chyby.push({
        riadok: r.cislo,
        stlpec: "kod",
        sprava: `Duplicitný kód „${kod}" v súbore — prvý výskyt na riadku ${prvy}.`,
      });
      continue;
    }
    prveVyskyty.set(kod, r.cislo);

    let normaKg: string;
    try {
      normaKg = normalizujQty(r.polia.norma_kg_na_par, "Norma na pár");
    } catch (e) {
      chyby.push({
        riadok: r.cislo,
        stlpec: "norma_kg_na_par",
        sprava: e instanceof Error ? e.message : "Neplatné číslo.",
      });
      continue;
    }

    let cyklusS: number | null = null;
    if (r.polia.cielovy_cas_cyklu_s !== "") {
      cyklusS = Number(r.polia.cielovy_cas_cyklu_s);
      // Kladné celé číslo v rozsahu int4 — nula aj pretečenie musia padnúť
      // už v kontrole, nie až v službe/DB (dry-run = ostrý beh).
      if (
        !/^\d+$/.test(r.polia.cielovy_cas_cyklu_s) ||
        cyklusS <= 0 ||
        cyklusS > 2_147_483_647
      ) {
        chyby.push({
          riadok: r.cislo,
          stlpec: "cielovy_cas_cyklu_s",
          sprava: `Cieľový čas cyklu „${r.polia.cielovy_cas_cyklu_s}" musí byť kladné celé číslo sekúnd.`,
        });
        continue;
      }
    }

    let cenaCenty: number | null = null;
    if (r.polia.predajna_cena_eur !== "") {
      try {
        cenaCenty = parseEurToCents(r.polia.predajna_cena_eur);
      } catch (e) {
        chyby.push({
          riadok: r.cislo,
          stlpec: "predajna_cena_eur",
          sprava: e instanceof Error ? e.message : "Neplatná suma.",
        });
        continue;
      }
      if (cenaCenty <= 0) {
        chyby.push({
          riadok: r.cislo,
          stlpec: "predajna_cena_eur",
          sprava: "Predajná cena musí byť kladná.",
        });
        continue;
      }
    }

    zaznamy.push({
      riadok: r.cislo,
      kod,
      nazov: r.polia.nazov,
      kodZmesi: r.polia.kod_zmesi,
      normaKg,
      cyklusS,
      cenaCenty,
    });
  }
  if (chyby.length > 0) {
    return { chyby, prehlad: PRAZDNY_PREHLAD };
  }

  // ── zápis (dry-run = ten istý kód v rollback transakcii, viď spustenie.ts) ──
  return spustiImport(db, vstup.dryRun, async (klient) => {
    const zmesi = await klient
      .select()
      .from(schema.mixtures)
      .where(isNull(schema.mixtures.deletedAt));
    const zmesPodlaKodu = new Map(zmesi.map((z) => [z.code, z]));
    const artikle = await klient
      .select()
      .from(schema.soleModels)
      .where(isNull(schema.soleModels.deletedAt));
    const artikelPodlaKodu = new Map(artikle.map((a) => [a.code, a]));

    const chybyRef: ImportChyba[] = [];
    for (const z of zaznamy) {
      if (!zmesPodlaKodu.has(z.kodZmesi)) {
        chybyRef.push({
          riadok: z.riadok,
          stlpec: "kod_zmesi",
          sprava: `Zmes „${z.kodZmesi}" neexistuje — najprv naimportuj receptúry.`,
        });
      }
    }
    if (chybyRef.length > 0) {
      return { chyby: chybyRef, prehlad: PRAZDNY_PREHLAD };
    }

    const prehlad = { ...PRAZDNY_PREHLAD };
    for (const z of zaznamy) {
      const mixtureId = zmesPodlaKodu.get(z.kodZmesi)?.id as string;
      const existujuci = artikelPodlaKodu.get(z.kod);
      try {
        if (existujuci) {
          if (vstup.rezim === "len_nove") {
            prehlad.preskocenych++;
            continue;
          }
          await updateArtikel(klient, {
            userId: vstup.userId,
            id: existujuci.id,
            code: z.kod,
            name: z.nazov,
            mixtureId,
            mixtureKgPerPair: z.normaKg,
            // Prázdne políčko nemaže existujúcu hodnotu.
            targetCycleSeconds: z.cyklusS ?? existujuci.targetCycleSeconds,
            salePriceCents: z.cenaCenty ?? existujuci.salePriceCents,
          });
          prehlad.aktualizovanych++;
        } else {
          await vytvorArtikel(klient, {
            userId: vstup.userId,
            code: z.kod,
            name: z.nazov,
            mixtureId,
            mixtureKgPerPair: z.normaKg,
            targetCycleSeconds: z.cyklusS,
            salePriceCents: z.cenaCenty,
          });
          prehlad.novych++;
        }
      } catch (e) {
        throw new ImportRiadokChyba(z.riadok, domenovaSprava(e));
      }
    }

    await zapisAuditImportu(klient, {
      userId: vstup.userId,
      typ: "artikle",
      rezim: vstup.rezim,
      subor: vstup.nazovSuboru,
      prehlad,
    });
    return { chyby: [], prehlad };
  });
}
