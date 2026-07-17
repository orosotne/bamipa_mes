// D10 import dodávateľov. Suppliers nemajú kód — kľúč zhody: IČO (ak je
// vyplnené), inak názov (trim, case-insensitive). Zápis cez existujúce služby
// (audit per záznam zadarmo); celý import = 1 transakcia. Súbežné importy /
// ručné vytvorenie chráni unique index 0009 (suppliers_ico_uq, suppliers_name_uq
// na lower(trim(name)) — zhodný s in-file dedupom); 23505 → doménová hláška
// v createSupplier/updateSupplier.
import { isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import {
  createSupplier,
  type SupplierPolia,
  updateSupplier,
} from "@/server/suppliers/service";
import { domenovaSprava, ImportRiadokChyba, zapisAuditImportu } from "./audit";
import { type ImportChyba, parseCsv } from "./csv";
import { spustiImport } from "./spustenie";
import {
  type ImportVstup,
  type ImportVysledok,
  PRAZDNY_PREHLAD,
} from "./typy";

const STLPCE = {
  povinne: ["nazov"],
  volitelne: ["ico", "dic", "ic_dph", "adresa", "email", "telefon", "poznamka"],
} as const;

type Zaznam = {
  riadok: number;
  ico: string;
  nazovKluc: string;
  data: SupplierPolia;
};

function naNull(hodnota: string): string | null {
  return hodnota === "" ? null : hodnota;
}

export async function importujDodavatelov(
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
    const nazov = r.polia.nazov;
    if (nazov === "") {
      chyby.push({
        riadok: r.cislo,
        stlpec: "nazov",
        sprava: "Názov dodávateľa je povinný.",
      });
      continue;
    }
    const ico = r.polia.ico;
    const nazovKluc = nazov.toLowerCase();
    // Názov aj IČO sú kľúče zhody — duplicita ktoréhokoľvek v súbore je chyba
    // (dva riadky s rovnakým názvom a rôznym IČO sú ambiguitné).
    const prvy =
      prveVyskyty.get(`nazov:${nazovKluc}`) ??
      (ico !== "" ? prveVyskyty.get(`ico:${ico}`) : undefined);
    if (prvy !== undefined) {
      chyby.push({
        riadok: r.cislo,
        sprava: `Duplicitný dodávateľ v súbore — prvý výskyt na riadku ${prvy}.`,
      });
      continue;
    }
    prveVyskyty.set(`nazov:${nazovKluc}`, r.cislo);
    if (ico !== "") prveVyskyty.set(`ico:${ico}`, r.cislo);
    zaznamy.push({
      riadok: r.cislo,
      ico,
      nazovKluc,
      data: {
        name: nazov,
        ico: naNull(ico),
        dic: naNull(r.polia.dic),
        icDph: naNull(r.polia.ic_dph),
        address: naNull(r.polia.adresa),
        email: naNull(r.polia.email),
        phone: naNull(r.polia.telefon),
        note: naNull(r.polia.poznamka),
      },
    });
  }
  if (chyby.length > 0) {
    return { chyby, prehlad: PRAZDNY_PREHLAD };
  }

  // ── zápis (dry-run = ten istý kód v rollback transakcii, viď spustenie.ts) ──
  return spustiImport(db, vstup.dryRun, async (klient) => {
    const existujuci = await klient
      .select()
      .from(schema.suppliers)
      .where(isNull(schema.suppliers.deletedAt));
    const podlaIco = new Map(
      existujuci.filter((d) => d.ico).map((d) => [d.ico as string, d]),
    );
    const podlaNazvu = new Map(
      existujuci.map((d) => [d.name.trim().toLowerCase(), d]),
    );

    const prehlad = { ...PRAZDNY_PREHLAD };
    // Dva riadky súboru sa nesmú trafiť do TOHO ISTÉHO DB záznamu cez rôzne
    // kľúče (riadok A názvom, riadok B IČO-m) — tichý prepis + dvojité počty.
    const spracovaneId = new Set<string>();
    for (const z of zaznamy) {
      const zhoda =
        (z.ico !== "" ? podlaIco.get(z.ico) : undefined) ??
        podlaNazvu.get(z.nazovKluc);
      if (zhoda) {
        if (spracovaneId.has(zhoda.id)) {
          throw new ImportRiadokChyba(
            z.riadok,
            `Riadok sa zhoduje s tým istým dodávateľom („${zhoda.name}") ako skorší riadok súboru — zlúč ich do jedného.`,
          );
        }
        spracovaneId.add(zhoda.id);
      }
      try {
        if (zhoda) {
          if (vstup.rezim === "len_nove") {
            prehlad.preskocenych++;
            continue;
          }
          await updateSupplier(klient, {
            userId: vstup.userId,
            id: zhoda.id,
            ...z.data,
          });
          prehlad.aktualizovanych++;
        } else {
          await createSupplier(klient, { userId: vstup.userId, ...z.data });
          prehlad.novych++;
        }
      } catch (e) {
        throw new ImportRiadokChyba(z.riadok, domenovaSprava(e));
      }
    }

    await zapisAuditImportu(klient, {
      userId: vstup.userId,
      typ: "dodavatelia",
      rezim: vstup.rezim,
      subor: vstup.nazovSuboru,
      prehlad,
    });
    return { chyby: [], prehlad };
  });
}
