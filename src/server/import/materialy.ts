// D10 import materiálov. Kľúč zhody = kod. MJ a kategória tolerantné na
// veľkosť písmen a diakritiku; predvoleni_dodavatelia = názvy alebo IČO
// oddelené | (musia už existovať). Zápis cez existujúce služby.
import { isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { normalizujQty } from "@/server/action-utils";
import {
  createMaterial,
  type MaterialPolia,
  nastavPredvolenychDodavatelov,
  updateMaterial,
} from "@/server/materials/service";
import { domenovaSprava, ImportRiadokChyba, zapisAuditImportu } from "./audit";
import { type ImportChyba, normalizujKluc, parseCsv } from "./csv";
import { spustiImport } from "./spustenie";
import {
  type ImportVstup,
  type ImportVysledok,
  PRAZDNY_PREHLAD,
} from "./typy";

const STLPCE = {
  povinne: ["kod", "nazov", "mj", "kategoria"],
  volitelne: ["min_zasoba", "predvoleni_dodavatelia", "poznamka"],
} as const;

type Zaznam = {
  riadok: number;
  kod: string;
  data: Omit<MaterialPolia, "code" | "name"> & { code: string; name: string };
  /** Tokeny zo stĺpca predvoleni_dodavatelia (názov alebo IČO). */
  dodavatelia: string[];
  /** Stĺpec bol vyplnený (rozlišuje „nemeniť väzby" od „nastaviť prázdne"). */
  dodavateliaVyplnene: boolean;
  minZasobaVyplnena: boolean;
  poznamkaVyplnena: boolean;
};

/** „Obalový materiál" → „obalovy_material" (porovnanie s pgEnum hodnotou). */
function normalizujEnum(hodnota: string): string {
  return normalizujKluc(hodnota).replace(/\s+/g, "_");
}

export async function importujMaterialy(
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
    const { kod, nazov } = { kod: r.polia.kod, nazov: r.polia.nazov };
    if (kod === "") {
      chyby.push({ riadok: r.cislo, stlpec: "kod", sprava: "Kód materiálu je povinný." });
      continue;
    }
    if (nazov === "") {
      chyby.push({ riadok: r.cislo, stlpec: "nazov", sprava: "Názov materiálu je povinný." });
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

    const mj = normalizujKluc(r.polia.mj) as MaterialPolia["unit"];
    if (!schema.materialUnit.enumValues.includes(mj)) {
      chyby.push({
        riadok: r.cislo,
        stlpec: "mj",
        sprava: `Neznáma merná jednotka „${r.polia.mj}" — povolené: ${schema.materialUnit.enumValues.join(", ")}.`,
      });
      continue;
    }
    const kategoria = normalizujEnum(r.polia.kategoria) as MaterialPolia["category"];
    if (!schema.materialCategory.enumValues.includes(kategoria)) {
      chyby.push({
        riadok: r.cislo,
        stlpec: "kategoria",
        sprava: `Neznáma kategória „${r.polia.kategoria}" — povolené: ${schema.materialCategory.enumValues.join(", ")}.`,
      });
      continue;
    }

    let minZasoba: string | null = null;
    if (r.polia.min_zasoba !== "") {
      try {
        minZasoba = normalizujQty(r.polia.min_zasoba, "Minimálna zásoba");
      } catch (e) {
        chyby.push({
          riadok: r.cislo,
          stlpec: "min_zasoba",
          sprava: e instanceof Error ? e.message : "Neplatné číslo.",
        });
        continue;
      }
    }

    const dodavatelia = r.polia.predvoleni_dodavatelia
      .split("|")
      .map((t) => t.trim())
      .filter((t) => t !== "");

    zaznamy.push({
      riadok: r.cislo,
      kod,
      data: {
        code: kod,
        name: nazov,
        unit: mj,
        category: kategoria,
        minStockQty: minZasoba,
        note: r.polia.poznamka === "" ? null : r.polia.poznamka,
      },
      dodavatelia,
      // Podľa tokenov, nie surového reťazca — samotné „|" nesmie zmazať väzby.
      dodavateliaVyplnene: dodavatelia.length > 0,
      minZasobaVyplnena: r.polia.min_zasoba !== "",
      poznamkaVyplnena: r.polia.poznamka !== "",
    });
  }
  if (chyby.length > 0) {
    return { chyby, prehlad: PRAZDNY_PREHLAD };
  }

  // ── zápis (dry-run = ten istý kód v rollback transakcii, viď spustenie.ts) ──
  return spustiImport(db, vstup.dryRun, async (klient) => {
    const dodavatelia = await klient
      .select()
      .from(schema.suppliers)
      .where(isNull(schema.suppliers.deletedAt));
    const dodavatelPodlaIco = new Map(
      dodavatelia.filter((d) => d.ico).map((d) => [d.ico as string, d]),
    );
    const dodavatelPodlaNazvu = new Map(
      dodavatelia.map((d) => [d.name.trim().toLowerCase(), d]),
    );
    const materialy = await klient
      .select()
      .from(schema.materials)
      .where(isNull(schema.materials.deletedAt));
    const materialPodlaKodu = new Map(materialy.map((m) => [m.code, m]));

    // Referencie na dodávateľov over PRED zápismi — chyby idú všetky naraz.
    const chybyRef: ImportChyba[] = [];
    const rozriesene = new Map<number, string[]>();
    for (const z of zaznamy) {
      const ids: string[] = [];
      for (const token of z.dodavatelia) {
        const zhoda =
          dodavatelPodlaIco.get(token) ??
          dodavatelPodlaNazvu.get(token.toLowerCase());
        if (!zhoda) {
          chybyRef.push({
            riadok: z.riadok,
            stlpec: "predvoleni_dodavatelia",
            sprava: `Dodávateľ „${token}" neexistuje — najprv naimportuj dodávateľov.`,
          });
        } else {
          ids.push(zhoda.id);
        }
      }
      rozriesene.set(z.riadok, [...new Set(ids)]);
    }
    if (chybyRef.length > 0) {
      return { chyby: chybyRef, prehlad: PRAZDNY_PREHLAD };
    }

    const prehlad = { ...PRAZDNY_PREHLAD };
    for (const z of zaznamy) {
      const existujuci = materialPodlaKodu.get(z.kod);
      try {
        if (existujuci) {
          if (vstup.rezim === "len_nove") {
            prehlad.preskocenych++;
            continue;
          }
          await updateMaterial(klient, {
            userId: vstup.userId,
            id: existujuci.id,
            ...z.data,
            // Prázdne políčko nemaže existujúcu hodnotu.
            minStockQty: z.minZasobaVyplnena
              ? z.data.minStockQty
              : existujuci.minStockQty,
            note: z.poznamkaVyplnena ? z.data.note : existujuci.note,
          });
          if (z.dodavateliaVyplnene) {
            await nastavPredvolenychDodavatelov(klient, {
              userId: vstup.userId,
              materialId: existujuci.id,
              supplierIds: rozriesene.get(z.riadok) ?? [],
            });
          }
          prehlad.aktualizovanych++;
        } else {
          const novy = await createMaterial(klient, {
            userId: vstup.userId,
            ...z.data,
          });
          if (z.dodavateliaVyplnene) {
            await nastavPredvolenychDodavatelov(klient, {
              userId: vstup.userId,
              materialId: novy.id,
              supplierIds: rozriesene.get(z.riadok) ?? [],
            });
          }
          prehlad.novych++;
        }
      } catch (e) {
        throw new ImportRiadokChyba(z.riadok, domenovaSprava(e));
      }
    }

    await zapisAuditImportu(klient, {
      userId: vstup.userId,
      typ: "materialy",
      rezim: vstup.rezim,
      subor: vstup.nazovSuboru,
      prehlad,
    });
    return { chyby: [], prehlad };
  });
}
