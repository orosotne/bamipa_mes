// Dekódovanie nahraného CSV. Excel „CSV UTF-8" ukladá UTF-8 s BOM, ale bežné
// „CSV (oddelený čiarkami)" na slovenskom Windowse je Windows-1250 — striktné
// UTF-8 na ňom padne, tak diakritiku prevedieme automaticky namiesto
// odmietnutia súboru (nález review: tichá mojibake → teraz auto-konverzia).
export function dekodujCsv(bajty: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bajty);
  } catch {
    return new TextDecoder("windows-1250").decode(bajty);
  }
}

// Riadiace znaky (okrem tab/LF/CR) v texte = kódovanie, ktoré cp1250 nezachránil:
// UTF-16 zanechá U+0000 (NUL), nedefinované cp1250 bajty zanechajú C1 riadiace
// znaky (U+0080–U+009F), binárka rôzne. Legitímne CSV (aj cp1250 s diakritikou)
// obsahuje len tlačiteľné znaky + tab/newline, takže žiadny falošný poplach.
const RIADIACE_ZNAKY =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: zámerná detekcia
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/** True, ak dekódovaný text obsahuje riadiace znaky = zle detekované kódovanie. */
export function maZlomeneKodovanie(text: string): boolean {
  return RIADIACE_ZNAKY.test(text);
}
