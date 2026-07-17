// Jednotné spustenie importu: dry-run = ROVNAKÝ kód ako ostrý beh, len v
// transakcii, ktorá sa vždy rollbackne. Kontrola tak vidí aj guardy služieb
// a DB triggre/constrainty (zmena MJ, zmes so živými príkazmi, unique…) —
// náhľad sa nemôže rozísť s ostrým behom (nález review).
import type { DbClient } from "@/db";
import { ImportRiadokChyba } from "./audit";
import type { ImportVysledok } from "./typy";
import { PRAZDNY_PREHLAD } from "./typy";

/** Sentinel na vynútenie rollbacku dry-run transakcie. */
class DryRunKoniec extends Error {
  constructor(public readonly vysledok: ImportVysledok) {
    super("dry-run rollback");
  }
}

export async function spustiImport(
  db: DbClient,
  dryRun: boolean,
  telo: (klient: DbClient) => Promise<ImportVysledok>,
): Promise<ImportVysledok> {
  try {
    if (dryRun) {
      let vysledok: ImportVysledok | undefined;
      try {
        await db.transaction(async (tx) => {
          vysledok = await telo(tx);
          throw new DryRunKoniec(vysledok);
        });
      } catch (e) {
        if (!(e instanceof DryRunKoniec)) throw e;
      }
      // telo() vždy vráti hodnotu pred sentinelom — ! je bezpečné.
      return vysledok as ImportVysledok;
    }
    return await db.transaction((tx) => telo(tx));
  } catch (e) {
    if (e instanceof ImportRiadokChyba) {
      return {
        chyby: [{ riadok: e.riadok, sprava: e.message }],
        prehlad: PRAZDNY_PREHLAD,
      };
    }
    throw e;
  }
}
