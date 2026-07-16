// CSV generovanie pre exporty účtovníčke (M8, SPEC „exportovateľné do
// CSV/XLSX"): UTF-8 BOM + bodkočiarka + CRLF + desatinná čiarka, aby súbor
// otvoril Excel so sk-SK locale dvojklikom (bodkočiarka je tam predvolený
// oddeľovač zoznamu, čiarka desatinný znak).

// Konštruované cez fromCharCode — literálny BOM znak je v zdrojáku
// neviditeľný a pri editácii sa ľahko potichu stratí (reálny nález z E2E;
// chýbajúci BOM = Excel sk-SK zobrazí diakritiku rozbite).
const BOM = String.fromCharCode(0xfeff);

// CSV formula injection (CWE-1236): bunku začínajúcu =, +, -, @ alebo TAB
// Excel vyhodnotí ako vzorec/DDE (quoting to NEzastaví) — neutralizujeme
// apostrofom. Výnimka: čisté čísla s desatinnou čiarkou (výstup eurCsv/
// ciarka), ktorým by apostrof rozbil súčty v Exceli.
const RIZIKOVY_ZACIATOK = /^[=+\-@\t]/;
const CISTE_CISLO = /^[+-]?\d+(?:,\d+)?$/;

function bunka(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (RIZIKOVY_ZACIATOK.test(s) && !CISTE_CISLO.test(s)) s = `'${s}`;
  return /[;"\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvSubor(
  hlavicka: string[],
  riadky: (string | number | null | undefined)[][],
): string {
  const lines = [hlavicka, ...riadky].map((r) => r.map(bunka).join(";"));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** 123456 (centy) → "1234,56" — číslo pre Excel bez meny a medzier. */
export function eurCsv(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${(abs % 100).toString().padStart(2, "0")}`;
}

/** DB numeric string ("480.65") → "480,65" (desatinná čiarka pre Excel). */
export function ciarka(n: string): string {
  return n.replace(".", ",");
}

/** Posunie desatinnú bodku o `o` miest doľava — čistá string aritmetika. */
function posunDolava(n: string, o: number): string {
  const [, sign, whole, frac = ""] = /^(-?)(\d+)(?:\.(\d*))?$/.exec(n.trim()) ?? [];
  if (whole === undefined) {
    throw new Error(`Neplatné číslo pre CSV: „${n}".`);
  }
  let cislice = whole + frac;
  let bodka = whole.length - o;
  if (bodka < 1) {
    cislice = "0".repeat(1 - bodka) + cislice;
    bodka = 1;
  }
  const des = cislice.slice(bodka);
  return `${sign}${cislice.slice(0, bodka)}${des ? `.${des}` : ""}`;
}

/** Centy s 2 des. ("480.65") → eurá "4,8065" (plná dokladová presnosť). */
export function eurCsv2(cents2: string | null): string {
  if (cents2 === null) return "";
  return ciarka(posunDolava(cents2, 2));
}

/**
 * Jednotková cena numeric(14,4) centov ("45.3500") → "0,4535" €/MJ —
 * koncové nuly orezané na min. 2 des. miesta.
 */
export function cenaCsv(price: string): string {
  const eur = posunDolava(price, 2);
  const [cele, des = ""] = eur.split(".");
  const orezane = des.replace(/0+$/, "").padEnd(2, "0");
  return ciarka(`${cele}.${orezane}`);
}
