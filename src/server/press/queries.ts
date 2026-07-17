// Čítacie queries lisovne (M6). Agregáty počítajú výhradne živé riadky
// (deleted_at IS NULL) — storno výkonu/DL ich okamžite vyradí. Zhodné
// s logikou DB triggerov (0004), aby UI ukazovalo to, čo guardy vynucujú.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

// ── artikle ──

export type ArtikelRiadok = typeof schema.soleModels.$inferSelect & {
  zmesCode: string;
  zmesName: string;
};

export async function zoznamArtiklov(db: DbClient): Promise<ArtikelRiadok[]> {
  const rows = await db
    .select({
      artikel: schema.soleModels,
      zmesCode: schema.mixtures.code,
      zmesName: schema.mixtures.name,
    })
    .from(schema.soleModels)
    .innerJoin(
      schema.mixtures,
      eq(schema.mixtures.id, schema.soleModels.mixtureId),
    )
    .where(isNull(schema.soleModels.deletedAt))
    .orderBy(asc(schema.soleModels.code));
  return rows.map((r) => ({ ...r.artikel, zmesCode: r.zmesCode, zmesName: r.zmesName }));
}

// ── výrobné príkazy ──

const vyrobeneParySub = sql<number>`coalesce((
  select sum(pr.pairs_produced)::int from press_runs pr
  where pr.work_order_id = ${schema.workOrders.id} and pr.deleted_at is null
), 0)`;
const cyklySub = sql<number>`coalesce((
  select sum(pr.cycles_count)::int from press_runs pr
  where pr.work_order_id = ${schema.workOrders.id} and pr.deleted_at is null
), 0)`;
const nepodarkySub = sql<number>`coalesce((
  select sum(d.qty_pairs)::int from press_run_defects d
  join press_runs pr on pr.id = d.press_run_id
  where pr.work_order_id = ${schema.workOrders.id}
    and d.deleted_at is null and pr.deleted_at is null
), 0)`;
const orezKgSub = sql<string>`coalesce((
  select sum(sr.qty_kg) from scrap_records sr
  where sr.work_order_id = ${schema.workOrders.id} and sr.deleted_at is null
), 0)::numeric(12,3)`;
const expedovaneSub = sql<number>`coalesce((
  select sum(si.qty_pairs)::int from shipment_items si
  where si.work_order_id = ${schema.workOrders.id} and si.deleted_at is null
), 0)`;

export type RiadokZoznamuPrikazov = {
  id: string;
  orderNumber: string;
  status: string;
  qtyPairsPlanned: number;
  createdAt: Date;
  artikelCode: string;
  artikelName: string;
  vyrobenePary: number;
  nepodarkyPary: number;
  cykly: number;
  orezKg: string;
  expedovanePary: number;
};

export async function zoznamPrikazov(
  db: DbClient,
): Promise<RiadokZoznamuPrikazov[]> {
  return db
    .select({
      id: schema.workOrders.id,
      orderNumber: schema.workOrders.orderNumber,
      status: schema.workOrders.status,
      qtyPairsPlanned: schema.workOrders.qtyPairsPlanned,
      createdAt: schema.workOrders.createdAt,
      artikelCode: schema.soleModels.code,
      artikelName: schema.soleModels.name,
      vyrobenePary: vyrobeneParySub,
      nepodarkyPary: nepodarkySub,
      cykly: cyklySub,
      orezKg: orezKgSub,
      expedovanePary: expedovaneSub,
    })
    .from(schema.workOrders)
    .innerJoin(
      schema.soleModels,
      eq(schema.soleModels.id, schema.workOrders.soleModelId),
    )
    .where(isNull(schema.workOrders.deletedAt))
    .orderBy(desc(schema.workOrders.createdAt));
}

export type VykonDetail = typeof schema.pressRuns.$inferSelect & {
  machineCode: string;
  workerName: string;
  davkaCislo: string;
  nepodarky: {
    id: string;
    defectReasonId: string;
    dovodName: string;
    qtyPairs: number;
  }[];
  prestoje: {
    id: string;
    reasonName: string;
    minutes: number;
    note: string | null;
  }[];
};

export type DetailPrikazu = {
  prikaz: typeof schema.workOrders.$inferSelect;
  artikel: ArtikelRiadok;
  vykony: VykonDetail[];
  prace: (typeof schema.workOrderLabor.$inferSelect & { workerName: string })[];
  orezy: (typeof schema.scrapRecords.$inferSelect)[];
  expedicie: {
    id: string;
    shipmentId: string;
    shipmentNumber: string;
    shipDate: string;
    qtyPairs: number;
  }[];
  suhrn: {
    vyrobenePary: number;
    nepodarkyPary: number;
    cykly: number;
    orezKg: string;
    expedovanePary: number;
    hotoveNaSklade: number;
  };
};

/** Súčet kg reťazcov numeric(12,3) bez floatov (mili-kg cez BigInt). */
function sucetKg(hodnoty: string[]): string {
  let mili = 0n;
  for (const h of hodnoty) {
    const [cela, des = ""] = h.split(".");
    mili += BigInt(cela) * 1000n + BigInt(des.padEnd(3, "0").slice(0, 3));
  }
  const zvysok = mili % 1000n;
  return `${mili / 1000n}.${String(zvysok).padStart(3, "0")}`;
}

export async function detailPrikazu(
  db: DbClient,
  id: string,
): Promise<DetailPrikazu> {
  const [hlavicka] = await db
    .select({
      prikaz: schema.workOrders,
      artikel: schema.soleModels,
      zmesCode: schema.mixtures.code,
      zmesName: schema.mixtures.name,
    })
    .from(schema.workOrders)
    .innerJoin(
      schema.soleModels,
      eq(schema.soleModels.id, schema.workOrders.soleModelId),
    )
    .innerJoin(
      schema.mixtures,
      eq(schema.mixtures.id, schema.soleModels.mixtureId),
    )
    .where(
      and(eq(schema.workOrders.id, id), isNull(schema.workOrders.deletedAt)),
    );
  if (!hlavicka) throw new Error("Výrobný príkaz neexistuje.");

  const runy = await db
    .select({
      run: schema.pressRuns,
      machineCode: schema.machines.code,
      workerName: schema.workers.fullName,
      davkaCislo: schema.productionBatches.batchNumber,
    })
    .from(schema.pressRuns)
    .innerJoin(
      schema.machines,
      eq(schema.machines.id, schema.pressRuns.machineId),
    )
    .innerJoin(schema.workers, eq(schema.workers.id, schema.pressRuns.workerId))
    .innerJoin(
      schema.productionBatches,
      eq(schema.productionBatches.id, schema.pressRuns.batchId),
    )
    .where(
      and(
        eq(schema.pressRuns.workOrderId, id),
        isNull(schema.pressRuns.deletedAt),
      ),
    )
    .orderBy(asc(schema.pressRuns.runDate), asc(schema.pressRuns.createdAt));

  const runIds = runy.map((r) => r.run.id);
  const defects = runIds.length
    ? await db
        .select({
          id: schema.pressRunDefects.id,
          pressRunId: schema.pressRunDefects.pressRunId,
          defectReasonId: schema.pressRunDefects.defectReasonId,
          dovodName: schema.defectReasons.name,
          qtyPairs: schema.pressRunDefects.qtyPairs,
        })
        .from(schema.pressRunDefects)
        .innerJoin(
          schema.defectReasons,
          eq(schema.defectReasons.id, schema.pressRunDefects.defectReasonId),
        )
        .where(
          and(
            inArray(schema.pressRunDefects.pressRunId, runIds),
            isNull(schema.pressRunDefects.deletedAt),
          ),
        )
    : [];
  const downtimes = runIds.length
    ? await db
        .select({
          id: schema.pressRunDowntimes.id,
          pressRunId: schema.pressRunDowntimes.pressRunId,
          reasonName: schema.downtimeReasons.name,
          minutes: schema.pressRunDowntimes.minutes,
          note: schema.pressRunDowntimes.note,
        })
        .from(schema.pressRunDowntimes)
        .innerJoin(
          schema.downtimeReasons,
          eq(schema.downtimeReasons.id, schema.pressRunDowntimes.reasonId),
        )
        .where(
          and(
            inArray(schema.pressRunDowntimes.pressRunId, runIds),
            isNull(schema.pressRunDowntimes.deletedAt),
          ),
        )
    : [];

  const vykony: VykonDetail[] = runy.map((r) => ({
    ...r.run,
    machineCode: r.machineCode,
    workerName: r.workerName,
    davkaCislo: r.davkaCislo,
    nepodarky: defects
      .filter((d) => d.pressRunId === r.run.id)
      .map((d) => ({
        id: d.id,
        defectReasonId: d.defectReasonId,
        dovodName: d.dovodName,
        qtyPairs: d.qtyPairs,
      })),
    prestoje: downtimes
      .filter((p) => p.pressRunId === r.run.id)
      .map((p) => ({
        id: p.id,
        reasonName: p.reasonName,
        minutes: p.minutes,
        note: p.note,
      })),
  }));

  const prace = (
    await db
      .select({ praca: schema.workOrderLabor, workerName: schema.workers.fullName })
      .from(schema.workOrderLabor)
      .innerJoin(
        schema.workers,
        eq(schema.workers.id, schema.workOrderLabor.workerId),
      )
      .where(
        and(
          eq(schema.workOrderLabor.workOrderId, id),
          isNull(schema.workOrderLabor.deletedAt),
        ),
      )
      .orderBy(asc(schema.workOrderLabor.workDate))
  ).map((r) => ({ ...r.praca, workerName: r.workerName }));

  const orezy = await db
    .select()
    .from(schema.scrapRecords)
    .where(
      and(
        eq(schema.scrapRecords.workOrderId, id),
        isNull(schema.scrapRecords.deletedAt),
      ),
    )
    .orderBy(asc(schema.scrapRecords.recordDate));

  const expedicie = await db
    .select({
      id: schema.shipmentItems.id,
      shipmentId: schema.shipments.id,
      shipmentNumber: schema.shipments.shipmentNumber,
      shipDate: schema.shipments.shipDate,
      qtyPairs: schema.shipmentItems.qtyPairs,
    })
    .from(schema.shipmentItems)
    .innerJoin(
      schema.shipments,
      eq(schema.shipments.id, schema.shipmentItems.shipmentId),
    )
    .where(
      and(
        eq(schema.shipmentItems.workOrderId, id),
        isNull(schema.shipmentItems.deletedAt),
      ),
    )
    .orderBy(asc(schema.shipments.shipDate));

  const vyrobenePary = vykony.reduce((s, v) => s + v.pairsProduced, 0);
  const nepodarkyPary = defects.reduce((s, d) => s + d.qtyPairs, 0);
  const cykly = vykony.reduce((s, v) => s + v.cyclesCount, 0);
  const expedovanePary = expedicie.reduce((s, e) => s + e.qtyPairs, 0);

  return {
    prikaz: hlavicka.prikaz,
    artikel: {
      ...hlavicka.artikel,
      zmesCode: hlavicka.zmesCode,
      zmesName: hlavicka.zmesName,
    },
    vykony,
    prace,
    orezy,
    expedicie,
    suhrn: {
      vyrobenePary,
      nepodarkyPary,
      cykly,
      orezKg: sucetKg(orezy.map((o) => o.qtyKg)),
      expedovanePary,
      hotoveNaSklade: vyrobenePary - expedovanePary,
    },
  };
}

// ── dostupné dávky pre artikel (tvrdá brána v ponuke) ──

export type DostupnaDavka = {
  id: string;
  batchNumber: string;
  productionDate: string;
  outputKg: string;
  zostatokKg: string;
};

/**
 * Len dávky v stave 'schvalena' zo zmesi artiklu s nespotrebovaným zostatkom.
 * Najstaršia prvá (duch D1 FIFO).
 */
export async function dostupneDavkyPreArtikel(
  db: DbClient,
  soleModelId: string,
): Promise<DostupnaDavka[]> {
  const spotrebaSub = sql`coalesce((
    select sum(pr.mixture_kg) from press_runs pr
    where pr.batch_id = ${schema.productionBatches.id} and pr.deleted_at is null
  ), 0)`;

  return db
    .select({
      id: schema.productionBatches.id,
      batchNumber: schema.productionBatches.batchNumber,
      productionDate: schema.productionBatches.productionDate,
      outputKg: sql<string>`${schema.productionBatches.outputKg}`,
      zostatokKg: sql<string>`(${schema.productionBatches.outputKg} - ${spotrebaSub})::numeric(12,3)`,
    })
    .from(schema.productionBatches)
    .innerJoin(
      schema.recipes,
      eq(schema.recipes.id, schema.productionBatches.recipeId),
    )
    .where(
      and(
        eq(schema.productionBatches.status, "schvalena"),
        isNull(schema.productionBatches.deletedAt),
        sql`${schema.recipes.mixtureId} = (
          select mixture_id from sole_models where id = ${soleModelId}
        )`,
        sql`${schema.productionBatches.outputKg} - ${spotrebaSub} > 0`,
      ),
    )
    .orderBy(
      asc(schema.productionBatches.productionDate),
      asc(schema.productionBatches.batchNumber),
    );
}

// ── expedícia ──

export type RiadokZoznamuDodacich = {
  id: string;
  shipmentNumber: string;
  shipDate: string;
  customer: string;
  polozkyPocet: number;
  paryCelkom: number;
};

export async function zoznamDodacichListov(
  db: DbClient,
): Promise<RiadokZoznamuDodacich[]> {
  return db
    .select({
      id: schema.shipments.id,
      shipmentNumber: schema.shipments.shipmentNumber,
      shipDate: schema.shipments.shipDate,
      customer: schema.shipments.customer,
      polozkyPocet: sql<number>`coalesce((
        select count(*)::int from shipment_items si
        where si.shipment_id = ${schema.shipments.id} and si.deleted_at is null
      ), 0)`,
      paryCelkom: sql<number>`coalesce((
        select sum(si.qty_pairs)::int from shipment_items si
        where si.shipment_id = ${schema.shipments.id} and si.deleted_at is null
      ), 0)`,
    })
    .from(schema.shipments)
    .where(isNull(schema.shipments.deletedAt))
    .orderBy(desc(schema.shipments.shipDate), desc(schema.shipments.createdAt));
}

export type DetailDodacieho = {
  dodaci: typeof schema.shipments.$inferSelect;
  polozky: {
    id: string;
    workOrderId: string;
    orderNumber: string;
    artikelCode: string;
    artikelName: string;
    qtyPairs: number;
    /** Dávky zmesí spotrebované príkazom — traceabilita DL → dávka. */
    davky: { batchId: string; batchNumber: string }[];
  }[];
};

export async function detailDodacieho(
  db: DbClient,
  id: string,
): Promise<DetailDodacieho> {
  const [dodaci] = await db
    .select()
    .from(schema.shipments)
    .where(and(eq(schema.shipments.id, id), isNull(schema.shipments.deletedAt)));
  if (!dodaci) throw new Error("Dodací list neexistuje.");

  const items = await db
    .select({
      id: schema.shipmentItems.id,
      workOrderId: schema.shipmentItems.workOrderId,
      orderNumber: schema.workOrders.orderNumber,
      artikelCode: schema.soleModels.code,
      artikelName: schema.soleModels.name,
      qtyPairs: schema.shipmentItems.qtyPairs,
    })
    .from(schema.shipmentItems)
    .innerJoin(
      schema.workOrders,
      eq(schema.workOrders.id, schema.shipmentItems.workOrderId),
    )
    .innerJoin(
      schema.soleModels,
      eq(schema.soleModels.id, schema.workOrders.soleModelId),
    )
    .where(
      and(
        eq(schema.shipmentItems.shipmentId, id),
        isNull(schema.shipmentItems.deletedAt),
      ),
    )
    .orderBy(asc(schema.workOrders.orderNumber));

  const orderIds = [...new Set(items.map((i) => i.workOrderId))];
  const davky = orderIds.length
    ? await db
        .selectDistinct({
          workOrderId: schema.pressRuns.workOrderId,
          batchId: schema.productionBatches.id,
          batchNumber: schema.productionBatches.batchNumber,
        })
        .from(schema.pressRuns)
        .innerJoin(
          schema.productionBatches,
          eq(schema.productionBatches.id, schema.pressRuns.batchId),
        )
        .where(
          and(
            inArray(schema.pressRuns.workOrderId, orderIds),
            isNull(schema.pressRuns.deletedAt),
          ),
        )
    : [];

  return {
    dodaci,
    polozky: items.map((i) => ({
      ...i,
      davky: davky
        .filter((d) => d.workOrderId === i.workOrderId)
        .map((d) => ({ batchId: d.batchId, batchNumber: d.batchNumber })),
    })),
  };
}

// ── traceability report pre odberateľa (F3) ──

/**
 * Plný reťazec pre externý report k DL: položky → výkony lisovne (stroj,
 * dátum, zmena) → dávky zmesí → posledný verdikt labáku s meraniami voči
 * snapshot limitom → šarže surovín (príjemka, dodávateľ, dátum príjmu).
 * Externý dokument — tvar NESMIE obsahovať ceny, čísla faktúr, internú
 * poznámku DL ani množstvá surovín (know-how receptúry); dodávateľ sa
 * doťahuje cez faktúru príjemky.
 * Zámerná nadmnožina (recall-safe): reťazec ide cez CELÝ príkaz, takže
 * výkon zapísaný po expedícii pridá dávku aj do skôr vytlačeného reportu —
 * bezpečnejšie než riskovať vylúčenie reálnej dávky pri oneskorenom zápise
 * z dielne; zhodné s internou traceabilitou (detailDodacieho).
 */
export type TraceabilitaDodacieho = {
  dodaci: {
    id: string;
    shipmentNumber: string;
    shipDate: string;
    customer: string;
    // interná poznámka DL (note) tu zámerne NIE JE — externý dokument
  };
  polozky: {
    orderNumber: string;
    artikelCode: string;
    artikelName: string;
    qtyPairs: number;
    vykony: {
      machineCode: string;
      machineName: string;
      runDate: string;
      shift: string;
      pairsProduced: number;
      batchNumber: string;
    }[];
  }[];
  /** Deduplikované — dávka použitá viacerými príkazmi je tu práve raz. */
  davky: {
    batchNumber: string;
    mixtureCode: string;
    mixtureName: string;
    productionDate: string;
    verdikt: {
      verdict: "schvalene" | "zamietnute";
      verdictAt: Date;
      verdictByName: string | null;
    } | null;
    merania: {
      parameterCode: string;
      parameterName: string;
      unit: string | null;
      value: string;
      minLimit: string | null;
      maxLimit: string | null;
      isWithinLimits: boolean;
    }[];
    sarze: {
      materialCode: string;
      materialName: string;
      supplierLotCode: string | null;
      receiptNumber: string;
      receivedAt: string;
      supplierName: string | null;
    }[];
  }[];
};

export async function traceabilitaDodacieho(
  db: DbClient,
  id: string,
): Promise<TraceabilitaDodacieho> {
  const [dodaci] = await db
    .select({
      id: schema.shipments.id,
      shipmentNumber: schema.shipments.shipmentNumber,
      shipDate: schema.shipments.shipDate,
      customer: schema.shipments.customer,
    })
    .from(schema.shipments)
    .where(and(eq(schema.shipments.id, id), isNull(schema.shipments.deletedAt)));
  if (!dodaci) throw new Error("Dodací list neexistuje.");

  const items = await db
    .select({
      workOrderId: schema.shipmentItems.workOrderId,
      orderNumber: schema.workOrders.orderNumber,
      artikelCode: schema.soleModels.code,
      artikelName: schema.soleModels.name,
      qtyPairs: schema.shipmentItems.qtyPairs,
    })
    .from(schema.shipmentItems)
    .innerJoin(
      schema.workOrders,
      eq(schema.workOrders.id, schema.shipmentItems.workOrderId),
    )
    .innerJoin(
      schema.soleModels,
      eq(schema.soleModels.id, schema.workOrders.soleModelId),
    )
    .where(
      and(
        eq(schema.shipmentItems.shipmentId, id),
        isNull(schema.shipmentItems.deletedAt),
      ),
    )
    .orderBy(asc(schema.workOrders.orderNumber));

  const orderIds = [...new Set(items.map((i) => i.workOrderId))];
  const vykony = orderIds.length
    ? await db
        .select({
          workOrderId: schema.pressRuns.workOrderId,
          machineCode: schema.machines.code,
          machineName: schema.machines.name,
          runDate: schema.pressRuns.runDate,
          shift: schema.pressRuns.shift,
          pairsProduced: schema.pressRuns.pairsProduced,
          batchId: schema.pressRuns.batchId,
          batchNumber: schema.productionBatches.batchNumber,
        })
        .from(schema.pressRuns)
        .innerJoin(
          schema.machines,
          eq(schema.machines.id, schema.pressRuns.machineId),
        )
        .innerJoin(
          schema.productionBatches,
          eq(schema.productionBatches.id, schema.pressRuns.batchId),
        )
        .where(
          and(
            inArray(schema.pressRuns.workOrderId, orderIds),
            isNull(schema.pressRuns.deletedAt),
          ),
        )
        .orderBy(asc(schema.pressRuns.runDate), asc(schema.pressRuns.createdAt))
    : [];

  const batchIds = [...new Set(vykony.map((v) => v.batchId))];
  const davkyHlavicky = batchIds.length
    ? await db
        .select({
          batchId: schema.productionBatches.id,
          batchNumber: schema.productionBatches.batchNumber,
          productionDate: schema.productionBatches.productionDate,
          mixtureCode: schema.mixtures.code,
          mixtureName: schema.mixtures.name,
        })
        .from(schema.productionBatches)
        .innerJoin(
          schema.recipes,
          eq(schema.recipes.id, schema.productionBatches.recipeId),
        )
        .innerJoin(
          schema.mixtures,
          eq(schema.mixtures.id, schema.recipes.mixtureId),
        )
        .where(inArray(schema.productionBatches.id, batchIds))
        .orderBy(asc(schema.productionBatches.batchNumber))
    : [];

  // Verdikt = POSLEDNÝ lab test dávky (najvyššie sequence_no) — po úprave
  // zamietnutej dávky platí nové meranie; limity zo snapshotov lab_results.
  const testy = batchIds.length
    ? await db
        .select({
          id: schema.labTests.id,
          batchId: schema.labTests.batchId,
          verdict: schema.labTests.verdict,
          verdictAt: schema.labTests.verdictAt,
          verdictByName: sql<
            string | null
          >`(SELECT display_name FROM users u WHERE u.id = ${schema.labTests.verdictBy})`,
        })
        .from(schema.labTests)
        .where(
          and(
            inArray(schema.labTests.batchId, batchIds),
            isNull(schema.labTests.deletedAt),
          ),
        )
        .orderBy(asc(schema.labTests.sequenceNo))
    : [];
  const poslednyTest = new Map<string, (typeof testy)[number]>();
  for (const t of testy) poslednyTest.set(t.batchId, t); // asc → posledný vyhrá

  const testIds = [...poslednyTest.values()].map((t) => t.id);
  const merania = testIds.length
    ? await db
        .select({
          labTestId: schema.labResults.labTestId,
          parameterCode: schema.labParameters.code,
          parameterName: schema.labParameters.name,
          unit: schema.labParameters.unit,
          value: schema.labResults.value,
          minLimit: schema.labResults.minLimitSnapshot,
          maxLimit: schema.labResults.maxLimitSnapshot,
          isWithinLimits: schema.labResults.isWithinLimits,
        })
        .from(schema.labResults)
        .innerJoin(
          schema.labParameters,
          eq(schema.labParameters.id, schema.labResults.parameterId),
        )
        .where(inArray(schema.labResults.labTestId, testIds))
        .orderBy(asc(schema.labParameters.sortOrder))
    : [];

  // Šarže s ČISTOU spotrebou dávky > 0 — storno navážky (korekcia s batch_id,
  // kladné delta) spotrebu vracia, preto SUM namiesto výpisu vydaj pohybov.
  const sarze = batchIds.length
    ? await db
        .select({
          batchId: schema.stockMoves.batchId,
          materialCode: schema.materials.code,
          materialName: schema.materials.name,
          supplierLotCode: schema.materialLots.supplierLotCode,
          receiptNumber: schema.receipts.receiptNumber,
          receivedAt: schema.receipts.receivedAt,
          supplierName: schema.suppliers.name,
        })
        .from(schema.stockMoves)
        .innerJoin(
          schema.materialLots,
          eq(schema.materialLots.id, schema.stockMoves.lotId),
        )
        .innerJoin(
          schema.materials,
          eq(schema.materials.id, schema.materialLots.materialId),
        )
        .innerJoin(
          schema.receipts,
          eq(schema.receipts.id, schema.materialLots.receiptId),
        )
        .leftJoin(
          schema.invoices,
          eq(schema.invoices.id, schema.receipts.invoiceId),
        )
        .leftJoin(
          schema.suppliers,
          eq(schema.suppliers.id, schema.invoices.supplierId),
        )
        .where(inArray(schema.stockMoves.batchId, batchIds))
        .groupBy(
          schema.stockMoves.batchId,
          schema.materialLots.id,
          schema.materials.code,
          schema.materials.name,
          schema.receipts.receiptNumber,
          schema.receipts.receivedAt,
          schema.suppliers.name,
        )
        .having(sql`sum(${schema.stockMoves.qtyDelta}) < 0`)
        // FIFO poradie zo schémy: received_at, receipt_number, line_no.
        .orderBy(
          asc(schema.materials.code),
          asc(schema.receipts.receivedAt),
          asc(schema.receipts.receiptNumber),
          asc(schema.materialLots.lineNo),
        )
    : [];

  return {
    dodaci,
    polozky: items.map((i) => ({
      orderNumber: i.orderNumber,
      artikelCode: i.artikelCode,
      artikelName: i.artikelName,
      qtyPairs: i.qtyPairs,
      vykony: vykony
        .filter((v) => v.workOrderId === i.workOrderId)
        .map((v) => ({
          machineCode: v.machineCode,
          machineName: v.machineName,
          runDate: v.runDate,
          shift: v.shift,
          pairsProduced: v.pairsProduced,
          batchNumber: v.batchNumber,
        })),
    })),
    davky: davkyHlavicky.map((d) => {
      const test = poslednyTest.get(d.batchId);
      return {
        batchNumber: d.batchNumber,
        mixtureCode: d.mixtureCode,
        mixtureName: d.mixtureName,
        productionDate: d.productionDate,
        verdikt:
          test?.verdict && test.verdictAt
            ? {
                verdict: test.verdict,
                verdictAt: test.verdictAt,
                verdictByName: test.verdictByName,
              }
            : null,
        merania: merania
          .filter((m) => m.labTestId === test?.id)
          .map((m) => ({
            parameterCode: m.parameterCode,
            parameterName: m.parameterName,
            unit: m.unit,
            value: m.value,
            minLimit: m.minLimit,
            maxLimit: m.maxLimit,
            isWithinLimits: m.isWithinLimits,
          })),
        sarze: sarze
          .filter((s) => s.batchId === d.batchId)
          .map((s) => ({
            materialCode: s.materialCode,
            materialName: s.materialName,
            supplierLotCode: s.supplierLotCode,
            receiptNumber: s.receiptNumber,
            receivedAt: s.receivedAt,
            supplierName: s.supplierName,
          })),
      };
    }),
  };
}
