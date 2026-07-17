// Súhrnný audit_log záznam per import (evidencia importov bez novej tabuľky).
// Per-záznamové audit riadky píšu existujúce služby (createSupplier…).
import { randomUUID } from "node:crypto";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { naVysledok } from "@/server/action-utils";
import type { ImportPrehlad, ImportRezim } from "./typy";

export async function zapisAuditImportu(
  db: DbClient,
  vstup: {
    userId: string;
    typ: "dodavatelia" | "materialy" | "receptury" | "artikle";
    rezim: ImportRezim;
    subor: string;
    prehlad: ImportPrehlad;
  },
): Promise<void> {
  await db.insert(schema.auditLog).values({
    tableName: "csv_import",
    recordId: randomUUID(),
    action: "import",
    changedBy: vstup.userId,
    changes: {
      typ: vstup.typ,
      rezim: vstup.rezim,
      subor: vstup.subor,
      novych: vstup.prehlad.novych,
      aktualizovanych: vstup.prehlad.aktualizovanych,
      preskocenych: vstup.prehlad.preskocenych,
    },
  });
}

/** Chyba viazaná na konkrétny riadok súboru — prenáša číslo riadku cez throw. */
export class ImportRiadokChyba extends Error {
  constructor(
    public readonly riadok: number,
    sprava: string,
  ) {
    super(sprava);
  }
}

/**
 * Doménová hláška z výnimky služby — cez naVysledok, aby sa do tabuľky chýb
 * nedostal surový „Failed query: …" SQL dump (nález review).
 */
export function domenovaSprava(e: unknown): string {
  const vysledok = naVysledok(e);
  return vysledok.ok ? "Neznáma chyba." : vysledok.error;
}
