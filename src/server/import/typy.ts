// Zdieľané typy D10 importov. Režim „len_nove" existujúce záznamy preskakuje
// (default — nič sa neprepisuje bez vedomia), „aktualizovat" prepíše vyplnené
// polia zo súboru; prázdne políčko ponecháva existujúcu hodnotu (nemaže).
import type { ImportChyba } from "./csv";

export type ImportRezim = "len_nove" | "aktualizovat";

export type ImportPrehlad = {
  novych: number;
  aktualizovanych: number;
  preskocenych: number;
};

export type ImportVysledok = {
  chyby: ImportChyba[];
  prehlad: ImportPrehlad;
};

export type ImportVstup = {
  userId: string;
  /** Surový obsah CSV súboru. */
  text: string;
  rezim: ImportRezim;
  /** Dry-run: len validácia a počty, žiadny zápis do DB. */
  dryRun: boolean;
  /** Názov súboru pre súhrnný audit_log záznam. */
  nazovSuboru: string;
};

export const PRAZDNY_PREHLAD: ImportPrehlad = {
  novych: 0,
  aktualizovanych: 0,
  preskocenych: 0,
};
