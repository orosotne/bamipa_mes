// D10 import receptúr. 1 riadok = 1 položka; riadky sa zoskupujú podľa
// kod_zmesi (údaje o zmesi stačia v prvom riadku skupiny). Verzie receptúr
// sa NIKDY neprepisujú — import vždy tvorí novú verziu cez createRecipeVersion
// (max+1, aktivácia, deaktivácia starej). „len_nove" preskočí zmesi, ktoré už
// nejakú receptúru majú; „aktualizovat" im pridá novú verziu a prepíše názov.
import { isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { normalizujQty } from "@/server/action-utils";
import {
  createMixture,
  createRecipeVersion,
  updateMixture,
} from "@/server/mixtures/service";
import { domenovaSprava, ImportRiadokChyba, zapisAuditImportu } from "./audit";
import { type ImportChyba, parseCsv } from "./csv";
import { spustiImport } from "./spustenie";
import {
  type ImportVstup,
  type ImportVysledok,
  PRAZDNY_PREHLAD,
} from "./typy";

const STLPCE = {
  povinne: ["kod_zmesi", "nazov_zmesi", "standardna_davka_kg", "kod_materialu", "mnozstvo_kg"],
  volitelne: ["tech_poznamka", "poradie"],
} as const;

type Polozka = {
  riadok: number;
  kodMaterialu: string;
  /** numeric(12,3) string */
  qtyKg: string;
  poradie?: number;
};

type Skupina = {
  kodZmesi: string;
  prvyRiadok: number;
  nazov: string;
  davkaKg: string;
  techPoznamka: string;
  polozky: Polozka[];
  /** Fyzické čísla všetkých riadkov skupiny (guard skupinových kontrol). */
  riadky: number[];
};

export async function importujReceptury(
  db: DbClient,
  vstup: ImportVstup,
): Promise<ImportVysledok> {
  const { riadky, chyby: chybyCsv } = parseCsv(vstup.text, STLPCE);
  if (chybyCsv.length > 0) {
    return { chyby: chybyCsv, prehlad: PRAZDNY_PREHLAD };
  }

  // ── zoskupenie podľa kod_zmesi + validácia polí ──
  const chyby: ImportChyba[] = [];
  const skupiny = new Map<string, Skupina>();
  for (const r of riadky) {
    const kodZmesi = r.polia.kod_zmesi;
    if (kodZmesi === "") {
      chyby.push({
        riadok: r.cislo,
        stlpec: "kod_zmesi",
        sprava: "Kód zmesi je povinný v každom riadku.",
      });
      continue;
    }
    let skupina = skupiny.get(kodZmesi);
    if (!skupina) {
      skupina = {
        kodZmesi,
        prvyRiadok: r.cislo,
        nazov: "",
        davkaKg: "",
        techPoznamka: "",
        polozky: [],
        riadky: [],
      };
      skupiny.set(kodZmesi, skupina);
    }
    skupina.riadky.push(r.cislo);

    // Zmes-level polia: prvá neprázdna hodnota platí, odlišná neprázdna = chyba.
    if (r.polia.nazov_zmesi !== "") {
      if (skupina.nazov !== "" && skupina.nazov !== r.polia.nazov_zmesi) {
        chyby.push({
          riadok: r.cislo,
          stlpec: "nazov_zmesi",
          sprava: `Riadky zmesi „${kodZmesi}" majú rôzne názvy („${skupina.nazov}" vs. „${r.polia.nazov_zmesi}").`,
        });
        continue;
      }
      skupina.nazov = r.polia.nazov_zmesi;
    }
    if (r.polia.standardna_davka_kg !== "") {
      let davka: string;
      try {
        davka = normalizujQty(r.polia.standardna_davka_kg, "Štandardná dávka");
      } catch (e) {
        chyby.push({
          riadok: r.cislo,
          stlpec: "standardna_davka_kg",
          sprava: e instanceof Error ? e.message : "Neplatné číslo.",
        });
        continue;
      }
      if (skupina.davkaKg !== "" && skupina.davkaKg !== davka) {
        chyby.push({
          riadok: r.cislo,
          stlpec: "standardna_davka_kg",
          sprava: `Riadky zmesi „${kodZmesi}" majú rôzne štandardné dávky.`,
        });
        continue;
      }
      skupina.davkaKg = davka;
    }
    // Prvá neprázdna poznámka platí (README: údaje o zmesi v prvom riadku).
    if (skupina.techPoznamka === "" && r.polia.tech_poznamka !== "") {
      skupina.techPoznamka = r.polia.tech_poznamka;
    }

    // Položka.
    const kodMaterialu = r.polia.kod_materialu;
    if (kodMaterialu === "") {
      chyby.push({
        riadok: r.cislo,
        stlpec: "kod_materialu",
        sprava: "Kód materiálu je povinný v každom riadku.",
      });
      continue;
    }
    if (skupina.polozky.some((p) => p.kodMaterialu === kodMaterialu)) {
      chyby.push({
        riadok: r.cislo,
        stlpec: "kod_materialu",
        sprava: `Materiál „${kodMaterialu}" je v zmesi „${kodZmesi}" dvakrát.`,
      });
      continue;
    }
    let qtyKg: string;
    try {
      qtyKg = normalizujQty(r.polia.mnozstvo_kg, "Množstvo");
    } catch (e) {
      chyby.push({
        riadok: r.cislo,
        stlpec: "mnozstvo_kg",
        sprava: e instanceof Error ? e.message : "Neplatné číslo.",
      });
      continue;
    }
    let poradie: number | undefined;
    if (r.polia.poradie !== "") {
      if (!/^\d+$/.test(r.polia.poradie)) {
        chyby.push({
          riadok: r.cislo,
          stlpec: "poradie",
          sprava: `Poradie „${r.polia.poradie}" musí byť celé číslo.`,
        });
        continue;
      }
      poradie = Number(r.polia.poradie);
    }
    skupina.polozky.push({ riadok: r.cislo, kodMaterialu, qtyKg, poradie });
  }

  // Zmes-level povinnosti po zoskupení (štandardná dávka vždy; názov rieši DB
  // fáza). Skupiny s riadkovou chybou preskoč — dodatočné kontroly by boli šum.
  const chybneRiadky = new Set(chyby.map((ch) => ch.riadok));
  for (const skupina of skupiny.values()) {
    if (skupina.riadky.some((riadok) => chybneRiadky.has(riadok))) {
      continue;
    }
    if (skupina.davkaKg === "") {
      chyby.push({
        riadok: skupina.prvyRiadok,
        stlpec: "standardna_davka_kg",
        sprava: `Zmes „${skupina.kodZmesi}" nemá štandardnú dávku (vyplň v prvom riadku zmesi).`,
      });
    }
    if (skupina.polozky.length === 0) {
      chyby.push({
        riadok: skupina.prvyRiadok,
        sprava: `Zmes „${skupina.kodZmesi}" nemá žiadnu platnú položku.`,
      });
    }
  }
  if (chyby.length > 0) {
    return { chyby, prehlad: PRAZDNY_PREHLAD };
  }

  // ── zápis (dry-run = ten istý kód v rollback transakcii, viď spustenie.ts) ──
  return spustiImport(db, vstup.dryRun, async (klient) => {
    const materialy = await klient
      .select()
      .from(schema.materials)
      .where(isNull(schema.materials.deletedAt));
    const materialPodlaKodu = new Map(materialy.map((m) => [m.code, m]));
    const zmesi = await klient
      .select()
      .from(schema.mixtures)
      .where(isNull(schema.mixtures.deletedAt));
    const zmesPodlaKodu = new Map(zmesi.map((z) => [z.code, z]));
    const recepty = await klient
      .select({ mixtureId: schema.recipes.mixtureId })
      .from(schema.recipes);
    const zmesiSReceptom = new Set(recepty.map((r) => r.mixtureId));

    // Referencie over PRED zápismi — všetky chyby naraz.
    const chybyRef: ImportChyba[] = [];
    for (const skupina of skupiny.values()) {
      const zmes = zmesPodlaKodu.get(skupina.kodZmesi);
      if (!zmes && skupina.nazov === "") {
        chybyRef.push({
          riadok: skupina.prvyRiadok,
          stlpec: "nazov_zmesi",
          sprava: `Zmes „${skupina.kodZmesi}" neexistuje a súbor nemá jej názov — vyplň nazov_zmesi.`,
        });
      }
      for (const polozka of skupina.polozky) {
        const material = materialPodlaKodu.get(polozka.kodMaterialu);
        if (!material) {
          chybyRef.push({
            riadok: polozka.riadok,
            stlpec: "kod_materialu",
            sprava: `Materiál „${polozka.kodMaterialu}" neexistuje — najprv naimportuj materiály.`,
          });
        } else if (material.unit !== "kg") {
          chybyRef.push({
            riadok: polozka.riadok,
            stlpec: "kod_materialu",
            sprava: `Materiál „${polozka.kodMaterialu}" má MJ „${material.unit}" — receptúry sú v kg (D6).`,
          });
        }
      }
    }
    if (chybyRef.length > 0) {
      return { chyby: chybyRef, prehlad: PRAZDNY_PREHLAD };
    }

    const prehlad = { ...PRAZDNY_PREHLAD };
    for (const skupina of skupiny.values()) {
      const existujucaZmes = zmesPodlaKodu.get(skupina.kodZmesi);
      const maRecept =
        existujucaZmes !== undefined && zmesiSReceptom.has(existujucaZmes.id);
      if (maRecept && vstup.rezim === "len_nove") {
        prehlad.preskocenych++;
        continue;
      }
      try {
        let zmesId: string;
        if (existujucaZmes) {
          zmesId = existujucaZmes.id;
          if (
            vstup.rezim === "aktualizovat" &&
            skupina.nazov !== "" &&
            skupina.nazov !== existujucaZmes.name
          ) {
            await updateMixture(klient, {
              userId: vstup.userId,
              id: zmesId,
              code: existujucaZmes.code,
              name: skupina.nazov,
              note: existujucaZmes.note,
            });
          }
        } else {
          const nova = await createMixture(klient, {
            userId: vstup.userId,
            code: skupina.kodZmesi,
            name: skupina.nazov,
          });
          zmesId = nova.id;
        }

        // Poradie: explicitné poradie vyhráva, inak poradie riadkov (stabilné).
        const zoradene = skupina.polozky
          .map((p, idx) => ({ ...p, idx }))
          .sort(
            (a, b) =>
              (a.poradie ?? a.idx + 1) - (b.poradie ?? b.idx + 1) ||
              a.idx - b.idx,
          );
        await createRecipeVersion(klient, {
          userId: vstup.userId,
          mixtureId: zmesId,
          standardBatchKg: skupina.davkaKg,
          techNotes: skupina.techPoznamka === "" ? null : skupina.techPoznamka,
          polozky: zoradene.map((p) => ({
            materialId: materialPodlaKodu.get(p.kodMaterialu)?.id as string,
            qtyKg: p.qtyKg,
          })),
        });
        if (maRecept) {
          prehlad.aktualizovanych++;
        } else {
          prehlad.novych++;
        }
      } catch (e) {
        throw new ImportRiadokChyba(skupina.prvyRiadok, domenovaSprava(e));
      }
    }

    await zapisAuditImportu(klient, {
      userId: vstup.userId,
      typ: "receptury",
      rezim: vstup.rezim,
      subor: vstup.nazovSuboru,
      prehlad,
    });
    return { chyby: [], prehlad };
  });
}
