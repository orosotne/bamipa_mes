// Výrobné dávky valcovne (M4). DI DbClient, slovenské doménové chyby, audit_log.
// Stavový automat (rozpracovana → caka_na_labak → schvalena/zamietnuta;
// zamietnuta → caka_na_labak) vynucuje DB trigger (0001_rls_triggers_guards.sql)
// — táto vrstva iba pridáva app-level validáciu vstupov a audit trail; chybové
// hlášky DB triggra (napr. "Neplatný prechod stavu") sú už slovenské a
// propagujú sa bez zabalenia (SPEC §12: "over aj cez API").
import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import { vydajNavazky } from "@/server/inventory/issue";
import { parseQty } from "@/server/inventory/money";
import { sadzbaKDatumu } from "@/server/workers/service";

const ZMENY = ["ranna", "poobedna", "nocna"] as const;
function validujZmenu(shift: string): void {
  if (!(ZMENY as readonly string[]).includes(shift)) {
    throw new Error(
      `Neplatná zmena: „${shift}" (povolené: ranná, poobedná, nočná).`,
    );
  }
}

/**
 * Server-side zámok: navážka/práca/prestoje/časy sa smú meniť LEN kým je
 * dávka rozpracovaná. UI skrýva formuláre podľa toho istého pravidla, ale
 * bez tejto kontroly by priame volanie server action (starý tab, druhý
 * tablet, DevTools) obišlo zámok — SPEC §12 vyžaduje vynútenie "aj cez API,
 * nie len UI" pre stavový automat dávky. Rework (zamietnuta → úprava cez
 * batch_adjustments) je mimo M4 — táto vrstva ho zatiaľ nepozná, preto
 * povoľuje mutácie výhradne v stave 'rozpracovana'.
 */
async function overStavRozpracovana(
  db: DbClient,
  batchId: string,
): Promise<void> {
  const [davka] = await db
    .select({ status: schema.productionBatches.status })
    .from(schema.productionBatches)
    .where(eq(schema.productionBatches.id, batchId));
  if (!davka) {
    throw new Error("Dávka neexistuje.");
  }
  if (davka.status !== "rozpracovana") {
    throw new Error(
      `Dávka je uzamknutá (stav „${davka.status}") — záznam nemožno upraviť.`,
    );
  }
}

/**
 * Zámok pre dodatočné spotreby (výdaj materiálu / práca). Bežná navážka je
 * viazaná na stav 'rozpracovana'. Rework po zamietnutí labákom (SPEC §2.2)
 * povoľuje výdaj/prácu aj v stave 'zamietnuta', ak je zadaná úprava
 * (adjustmentId) patriaca TEJ ISTEJ dávke — vícenáklady sa kumulujú na dávke.
 * Prestoje a časy ostávajú viazané len na 'rozpracovana' (overStavRozpracovana).
 */
async function overStavPreSpotrebu(
  db: DbClient,
  batchId: string,
  adjustmentId?: string,
): Promise<void> {
  const [davka] = await db
    .select({ status: schema.productionBatches.status })
    .from(schema.productionBatches)
    .where(eq(schema.productionBatches.id, batchId));
  if (!davka) {
    throw new Error("Dávka neexistuje.");
  }
  if (davka.status === "rozpracovana") {
    return;
  }
  if (davka.status === "zamietnuta" && adjustmentId) {
    const [adj] = await db
      .select({ id: schema.batchAdjustments.id })
      .from(schema.batchAdjustments)
      .where(
        and(
          eq(schema.batchAdjustments.id, adjustmentId),
          eq(schema.batchAdjustments.batchId, batchId),
          isNull(schema.batchAdjustments.deletedAt),
        ),
      );
    if (!adj) {
      throw new Error("Úprava (rework) nepatrí tejto dávke.");
    }
    return;
  }
  throw new Error(
    `Dávka je uzamknutá (stav „${davka.status}") — záznam nemožno upraviť.`,
  );
}

export async function zalozDavku(
  db: DbClient,
  vstup: {
    userId: string;
    batchNumber: string;
    mixtureId: string;
    /** "YYYY-MM-DD" */
    productionDate: string;
    shift: string;
    machineId: string;
    leadWorkerId: string;
    /** numeric(6,3) string, default "1" */
    scaleFactor?: string;
    note?: string;
  },
): Promise<typeof schema.productionBatches.$inferSelect> {
  validujZmenu(vstup.shift);
  const scaleFactor = vstup.scaleFactor ?? "1";
  if (parseQty(scaleFactor) <= 0n) {
    throw new Error("Násobok dávky (scale factor) musí byť kladný.");
  }

  return db.transaction(async (tx) => {
    const [recept] = await tx
      .select()
      .from(schema.recipes)
      .where(
        and(
          eq(schema.recipes.mixtureId, vstup.mixtureId),
          eq(schema.recipes.isActive, true),
          isNull(schema.recipes.deletedAt),
        ),
      );
    if (!recept) {
      throw new Error(
        "Zmes nemá aktívnu verziu receptu — najprv ju aktivuj v Receptúrach.",
      );
    }

    const [davka] = await tx
      .insert(schema.productionBatches)
      .values({
        batchNumber: vstup.batchNumber,
        recipeId: recept.id,
        productionDate: vstup.productionDate,
        shift: vstup.shift,
        machineId: vstup.machineId,
        leadWorkerId: vstup.leadWorkerId,
        scaleFactor,
        note: vstup.note ?? null,
        createdBy: vstup.userId,
      })
      .returning();

    await tx.insert(schema.auditLog).values({
      tableName: "production_batches",
      recordId: davka.id,
      action: "insert",
      changedBy: vstup.userId,
      changes: { new: { batchNumber: vstup.batchNumber, recipeId: recept.id } },
    });

    return davka;
  });
}

export type VysledokVydajaNavazky = {
  pohyby: (typeof schema.stockMoves.$inferSelect)[];
};

/**
 * Vydá VŠETKY položky navážky v JEDNEJ transakcii (nested tx = savepointy
 * cez vydajNavazky) — nedostatok pri ktoromkoľvek materiáli vráti CELÚ
 * navážku bez jediného pohybu (žiadny čiastočný výdaj).
 */
export async function vydajNavazkuDavky(
  db: DbClient,
  vstup: {
    userId: string;
    batchId: string;
    polozky: { materialId: string; qty: string }[];
    /** rework: výdaj v rámci úpravy dávky po zamietnutí labákom */
    adjustmentId?: string;
  },
): Promise<VysledokVydajaNavazky> {
  return db.transaction(async (tx) => {
    await overStavPreSpotrebu(tx as DbClient, vstup.batchId, vstup.adjustmentId);

    const vsetkyPohyby: (typeof schema.stockMoves.$inferSelect)[] = [];
    for (const polozka of vstup.polozky) {
      const { pohyby } = await vydajNavazky(tx as DbClient, {
        userId: vstup.userId,
        batchId: vstup.batchId,
        materialId: polozka.materialId,
        qty: polozka.qty,
        adjustmentId: vstup.adjustmentId,
      });
      vsetkyPohyby.push(...pohyby);
    }
    return { pohyby: vsetkyPohyby };
  });
}

export async function pridajPracu(
  db: DbClient,
  vstup: {
    userId: string;
    batchId: string;
    workerId: string;
    /** "YYYY-MM-DD" */
    workDate: string;
    /** numeric(6,2) string */
    hours: string;
    adjustmentId?: string;
    note?: string;
  },
): Promise<typeof schema.batchLabor.$inferSelect> {
  await overStavPreSpotrebu(db, vstup.batchId, vstup.adjustmentId);
  const sadzba = await sadzbaKDatumu(db, vstup.workerId, vstup.workDate);

  const [zaznam] = await db
    .insert(schema.batchLabor)
    .values({
      batchId: vstup.batchId,
      workerId: vstup.workerId,
      workDate: vstup.workDate,
      hours: vstup.hours,
      hourlyRateCents: sadzba.hourlyRateCents,
      adjustmentId: vstup.adjustmentId ?? null,
      note: vstup.note ?? null,
      createdBy: vstup.userId,
    })
    .returning();

  return zaznam;
}

export async function pridajPrestoj(
  db: DbClient,
  vstup: {
    userId: string;
    batchId: string;
    reasonId: string;
    minutes: number;
    note?: string;
  },
): Promise<typeof schema.batchDowntimes.$inferSelect> {
  if (vstup.minutes <= 0) {
    throw new Error("Trvanie prestoja musí byť kladné.");
  }
  await overStavRozpracovana(db, vstup.batchId);

  const [prestoj] = await db
    .insert(schema.batchDowntimes)
    .values({
      batchId: vstup.batchId,
      reasonId: vstup.reasonId,
      minutes: vstup.minutes,
      note: vstup.note ?? null,
      createdBy: vstup.userId,
    })
    .returning();

  return prestoj;
}

export async function zmazPrestoj(
  db: DbClient,
  vstup: { userId: string; id: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [prestoj] = await tx
      .select({ batchId: schema.batchDowntimes.batchId })
      .from(schema.batchDowntimes)
      .where(eq(schema.batchDowntimes.id, vstup.id));
    if (!prestoj) {
      throw new Error("Prestoj neexistuje.");
    }
    await overStavRozpracovana(tx as DbClient, prestoj.batchId);

    await tx
      .update(schema.batchDowntimes)
      .set({ deletedAt: new Date() })
      .where(eq(schema.batchDowntimes.id, vstup.id));
  });
}

export async function aktualizujCasy(
  db: DbClient,
  vstup: { userId: string; batchId: string; workMinutes: number },
): Promise<typeof schema.productionBatches.$inferSelect> {
  if (vstup.workMinutes <= 0) {
    throw new Error("Čas (minúty) musí byť kladný.");
  }
  await overStavRozpracovana(db, vstup.batchId);

  const [davka] = await db
    .update(schema.productionBatches)
    .set({ workMinutes: vstup.workMinutes })
    .where(eq(schema.productionBatches.id, vstup.batchId))
    .returning();
  if (!davka) {
    throw new Error("Dávka neexistuje.");
  }
  return davka;
}

/**
 * Odovzdanie na labák (rozpracovana|zamietnuta → caka_na_labak): zapíše
 * skutočnú výrobu a posunie stav. Neplatný prechod (napr. dávka už
 * schválená) zachytí DB trigger — jeho slovenská hláška sa nezabaľuje.
 */
export async function odovzdajNaLabak(
  db: DbClient,
  vstup: { userId: string; batchId: string; outputKg: string },
): Promise<typeof schema.productionBatches.$inferSelect> {
  if (parseQty(vstup.outputKg) <= 0n) {
    throw new Error("Skutočná výroba (kg) musí byť kladná.");
  }

  return db.transaction(async (tx) => {
    const [povodny] = await tx
      .select()
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.id, vstup.batchId));
    if (!povodny) {
      throw new Error("Dávka neexistuje.");
    }

    const [davka] = await tx
      .update(schema.productionBatches)
      .set({ outputKg: vstup.outputKg, status: "caka_na_labak" })
      .where(eq(schema.productionBatches.id, vstup.batchId))
      .returning();

    await tx.insert(schema.auditLog).values({
      tableName: "production_batches",
      recordId: vstup.batchId,
      action: "status_change",
      changedBy: vstup.userId,
      changes: {
        old: { status: povodny.status },
        new: { status: "caka_na_labak", outputKg: vstup.outputKg },
      },
    });

    return davka;
  });
}
