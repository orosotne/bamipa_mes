// CSV parser pre D10 importy číselníkov. Bez závislostí — vstup od kolegu
// z Excelu: UTF-8 (aj s BOM), oddeľovač ; alebo , (autodetekcia z hlavičky),
// quoted polia podľa RFC 4180, desatinné čiarky ostávajú súčasťou hodnoty.
// Hlavičky tolerujú veľkosť písmen a diakritiku („Kód" → „kod").

export type ImportChyba = {
  /** Fyzické číslo riadku v súbore (hlavička = 1). */
  riadok: number;
  stlpec?: string;
  sprava: string;
};

export type CsvRiadok = {
  /** Fyzické číslo riadku, na ktorom záznam začína. */
  cislo: number;
  polia: Record<string, string>;
};

export const MAX_DATOVYCH_RIADKOV = 2000;

/** Tolerantný kľúč: trim, malé písmená, bez diakritiky („Kaučuk" → „kaucuk"). */
export function normalizujKluc(hodnota: string): string {
  return hodnota
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const normalizujNazov = normalizujKluc;

type Zaznam = { startLine: number; polia: string[] };

/** Rozseká text na záznamy; quoted polia môžu obsahovať oddeľovač aj \n. */
function tokenizuj(
  text: string,
  oddelovac: string,
): { zaznamy: Zaznam[]; chyba?: ImportChyba } {
  const zaznamy: Zaznam[] = [];
  let polia: string[] = [];
  let pole = "";
  let vUvodzovkach = false;
  let riadok = 1;
  let startLine = 1;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (vUvodzovkach) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          pole += '"';
          i += 2;
          continue;
        }
        vUvodzovkach = false;
        i++;
        continue;
      }
      if (c === "\n") riadok++;
      pole += c;
      i++;
      continue;
    }
    if (c === '"' && pole === "") {
      vUvodzovkach = true;
      i++;
      continue;
    }
    if (c === oddelovac) {
      polia.push(pole);
      pole = "";
      i++;
      continue;
    }
    if (c === "\n") {
      polia.push(pole);
      zaznamy.push({ startLine, polia });
      polia = [];
      pole = "";
      riadok++;
      startLine = riadok;
      i++;
      continue;
    }
    pole += c;
    i++;
  }

  if (vUvodzovkach) {
    return {
      zaznamy,
      chyba: {
        riadok: startLine,
        sprava: "Neuzavreté úvodzovky — skontroluj hodnoty v úvodzovkách.",
      },
    };
  }
  if (pole !== "" || polia.length > 0) {
    polia.push(pole);
    zaznamy.push({ startLine, polia });
  }
  return { zaznamy };
}

/** Oddeľovač podľa hlavičkového riadku: viac výskytov vyhráva, default ; */
function zistiOddelovac(text: string): string {
  const koniec = text.indexOf("\n");
  const hlavicka = koniec === -1 ? text : text.slice(0, koniec);
  const bodkociarky = (hlavicka.match(/;/g) ?? []).length;
  const ciarky = (hlavicka.match(/,/g) ?? []).length;
  return ciarky > bodkociarky ? "," : ";";
}

export function parseCsv(
  vstup: string,
  stlpce: { povinne: readonly string[]; volitelne?: readonly string[] },
): { riadky: CsvRiadok[]; chyby: ImportChyba[] } {
  // BOM preč + konce riadkov na \n (CRLF aj osamotené CR zo starých exportov).
  const text = vstup
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const volitelne = stlpce.volitelne ?? [];
  const zname = [...stlpce.povinne, ...volitelne];

  if (text.trim() === "") {
    return {
      riadky: [],
      chyby: [{ riadok: 1, sprava: "Súbor je prázdny." }],
    };
  }

  const oddelovac = zistiOddelovac(text);
  const { zaznamy, chyba: chybaTokenizacie } = tokenizuj(text, oddelovac);
  if (chybaTokenizacie) {
    return { riadky: [], chyby: [chybaTokenizacie] };
  }

  // Prázdne záznamy von ešte PRED výberom hlavičky (prázdny prvý riadok,
  // súbor obsahujúci len "" a pod. nesmú rozbiť detekciu stĺpcov).
  const neprazdne = zaznamy.filter((z) =>
    z.polia.some((pole) => pole.trim() !== ""),
  );
  if (neprazdne.length === 0) {
    return {
      riadky: [],
      chyby: [{ riadok: 1, sprava: "Súbor je prázdny." }],
    };
  }

  // ── hlavička ──
  const hlavicky = neprazdne[0].polia.map(normalizujNazov);
  const chybyHlavicky: ImportChyba[] = [];
  const videne = new Set<string>();
  for (const h of hlavicky) {
    // Prázdne názvy (Excel exportuje koncové prázdne stĺpce) sa ignorujú.
    if (h !== "" && videne.has(h)) {
      chybyHlavicky.push({
        riadok: 1,
        stlpec: h,
        sprava: `Stĺpec „${h}" je v hlavičke dvakrát.`,
      });
    }
    videne.add(h);
    if (h !== "" && !zname.includes(h)) {
      chybyHlavicky.push({
        riadok: 1,
        stlpec: h,
        sprava: `Neznámy stĺpec „${h}". Očakávané stĺpce: ${zname.join(", ")}.`,
      });
    }
  }
  for (const povinny of stlpce.povinne) {
    if (!hlavicky.includes(povinny)) {
      chybyHlavicky.push({
        riadok: 1,
        stlpec: povinny,
        sprava: `Chýba povinný stĺpec „${povinny}".`,
      });
    }
  }
  if (chybyHlavicky.length > 0) {
    return { riadky: [], chyby: chybyHlavicky };
  }

  // ── dátové riadky ──
  const datove = neprazdne.slice(1);
  if (datove.length === 0) {
    return {
      riadky: [],
      chyby: [{ riadok: 1, sprava: "Súbor neobsahuje žiadne dátové riadky." }],
    };
  }
  if (datove.length > MAX_DATOVYCH_RIADKOV) {
    return {
      riadky: [],
      chyby: [
        {
          riadok: 1,
          sprava: `Súbor má ${datove.length} riadkov — maximum je ${MAX_DATOVYCH_RIADKOV}. Rozdeľ ho na menšie časti.`,
        },
      ],
    };
  }

  const riadky: CsvRiadok[] = [];
  const chyby: ImportChyba[] = [];
  for (const zaznam of datove) {
    if (zaznam.polia.length > hlavicky.length) {
      chyby.push({
        riadok: zaznam.startLine,
        sprava: `Riadok má ${zaznam.polia.length} polí, hlavička len ${hlavicky.length} — skontroluj oddeľovače.`,
      });
      continue;
    }
    const polia: Record<string, string> = {};
    for (const nazov of zname) {
      polia[nazov] = "";
    }
    hlavicky.forEach((nazov, idx) => {
      if (nazov !== "") {
        polia[nazov] = (zaznam.polia[idx] ?? "").trim();
      }
    });
    riadky.push({ cislo: zaznam.startLine, polia });
  }

  return { riadky, chyby };
}
