// Testovacie fixtures pre M7 kalkulácie. Stavajú ručne prepočítateľný scenár
// „jún 2026" plným tokom M1–M6 (faktúry → sklad → dávky cez QC → výkony
// lisovne), aby uzávierka počítala nad reálnymi dokladmi, nie ohnutými stavmi.
//
// Ručný prepočet scenára (zdroj pravdy testov):
//   Pooly réžií júna: valcovňa 30 000 (réžia) + 12 000 (služby) + 60 000
//   (60 % zo 100 000 energie, D4) = 102 000 c; lisovňa 50 000 + 40 000
//   (40 % energie) = 90 000 c; labák 840 c; správa 21 000 c. Materiál
//   55 555 c a investícia 99 999 c do réžií NEVSTUPUJÚ.
//   Dávky: D1 (jún, 100 kg) materiál 50 kg × 45,35 c = 2 267,5 → 2 268 c,
//   práca 2,00 h × 1 000 c = 2 000 c → priamy náklad 4 268 c.
//   D2 (jún, 60 kg) materiál 30 kg × 45,35 = 1 360,5 → 1 361 c, práca
//   1,50 h × 1 200 c = 1 800 c → priamy náklad 3 161 c. Σ priame 7 429 c.
//   Lisovňa: príkaz P1, výkony R1 (dávka D1: 120 cyklov, 230 párov, 60 kg,
//   7 nepodarkov) + R2 (dávka D2: 80 cyklov, 150 párov, 40 kg); práca
//   3,00 h × 900 c = 2 700 c; orez 5 kg. Σ cykly 200.
import { eq } from "drizzle-orm";
import type * as schema from "@/db/schema";
import * as s from "@/db/schema";
import { vydajNavazky } from "@/server/inventory/issue";
import { pociatocnyStav } from "@/server/inventory/receipts";
import { odovzdajNaLabak } from "@/server/batches/service";
import { vynesVerdikt, zapisMerania } from "@/server/lab/service";
import type { LisovnaZaklad, Zaklad } from "@/server/press/fixtures";
import { zalozPrikaz } from "@/server/press/orders";
import { zapisVykon } from "@/server/press/runs";
import { zapisOrez } from "@/server/press/scrap";
import type { TestDb } from "@/test/pglite";

/** Spojí message reťazec chyby vrátane cause (DrizzleQueryError balí PG chybu). */
export function plnaHlaska(e: unknown): string {
  const casti: string[] = [];
  let cur = e as { message?: string; cause?: unknown } | undefined;
  while (cur) {
    if (typeof cur.message === "string") casti.push(cur.message);
    cur = cur.cause as { message?: string; cause?: unknown } | undefined;
  }
  return casti.join(" | ");
}

export type KalkZaklad = {
  labak: typeof schema.costCenters.$inferSelect;
  sprava: typeof schema.costCenters.$inferSelect;
  /** Artikel na ZMES-A: norma 0,250 kg/pár, predajná cena 900 c (marže). */
  artikel: typeof schema.soleModels.$inferSelect;
};

/** Strediská labák + správa a kalkulačný artikel s predajnou cenou. */
export async function seedKalkulacieZaklad(
  db: TestDb,
  z: Zaklad,
): Promise<KalkZaklad> {
  const [labak] = await db
    .insert(s.costCenters)
    .values({ code: "labak", name: "Labák", createdBy: z.adminId })
    .returning();
  const [sprava] = await db
    .insert(s.costCenters)
    .values({ code: "sprava", name: "Správa", createdBy: z.adminId })
    .returning();
  const [artikel] = await db
    .insert(s.soleModels)
    .values({
      code: "POD-CALC",
      name: "Podošva Kalk",
      mixtureId: z.zmes.id,
      mixtureKgPerPair: "0.250",
      salePriceCents: 900,
      createdBy: z.adminId,
    })
    .returning();
  // D4 pomer 60/40 (ako produkčný seed).
  await db.insert(s.calcSettings).values({
    code: "default",
    energyValcovnaPct: 60,
    energyLisovnaPct: 40,
    createdBy: z.adminId,
  });
  return { labak, sprava, artikel };
}

/** Faktúra s réžijnými položkami; net = gross (DPH 0), delivery = nákladový mesiac. */
export async function seedRezijnaFaktura(
  db: TestDb,
  z: Zaklad,
  vstup: {
    cislo: string;
    deliveryDate: string;
    polozky: {
      category: "material" | "energia" | "sluzby" | "investicia" | "rezia";
      costCenterId: string;
      totalNetCents: number;
    }[];
  },
) {
  const net = vstup.polozky.reduce((sum, p) => sum + p.totalNetCents, 0);
  const [faktura] = await db
    .insert(s.invoices)
    .values({
      supplierId: z.dodavatel.id,
      invoiceNumber: vstup.cislo,
      deliveryDate: vstup.deliveryDate,
      dueDate: "2026-12-31",
      totalNetCents: net,
      totalVatCents: 0,
      totalGrossCents: net,
      createdBy: z.adminId,
    })
    .returning();
  for (const p of vstup.polozky) {
    await db.insert(s.invoiceItems).values({
      invoiceId: faktura.id,
      description: `${p.category} položka`,
      category: p.category,
      costCenterId: p.costCenterId,
      totalNetCents: p.totalNetCents,
      createdBy: z.adminId,
    });
  }
  return faktura;
}

/** Réžijné faktúry júna podľa ručného prepočtu v hlavičke súboru. */
export async function seedRezijneFakturyJun(
  db: TestDb,
  z: Zaklad,
  lz: LisovnaZaklad,
  kz: KalkZaklad,
) {
  await seedRezijnaFaktura(db, z, {
    cislo: "FA-REZIE-2026-06",
    deliveryDate: "2026-06-15",
    polozky: [
      { category: "rezia", costCenterId: z.stredisko.id, totalNetCents: 30000 },
      { category: "sluzby", costCenterId: z.stredisko.id, totalNetCents: 12000 },
      // Energia zámerne zaúčtovaná na správu — D4 split ju delí valcovňa/
      // lisovňa bez ohľadu na zaúčtované stredisko (celofiremná faktúra).
      { category: "energia", costCenterId: kz.sprava.id, totalNetCents: 100000 },
      { category: "rezia", costCenterId: lz.lisovna.id, totalNetCents: 50000 },
      { category: "sluzby", costCenterId: kz.labak.id, totalNetCents: 840 },
      { category: "rezia", costCenterId: kz.sprava.id, totalNetCents: 21000 },
      // Kontrolné položky — do poolov réžií NESMÚ vstúpiť:
      { category: "material", costCenterId: z.stredisko.id, totalNetCents: 55555 },
      { category: "investicia", costCenterId: z.stredisko.id, totalNetCents: 99999 },
    ],
  });
}

/**
 * Dávka plným tokom M4+M5: založenie s dátumom → navážka zo skladu → práca →
 * odovzdanie na labák (output_kg) → meranie v limite → verdikt SCHVÁLENÉ.
 */
export async function pripravDavkuSNakladmi(
  db: TestDb,
  z: Zaklad,
  lz: LisovnaZaklad,
  vstup: {
    cislo: string;
    productionDate: string;
    vydajKg: string;
    pracaHodiny: string;
    pracaSadzbaCents: number;
    outputKg: string;
    schvalit?: boolean;
  },
): Promise<typeof schema.productionBatches.$inferSelect> {
  const [davka] = await db
    .insert(s.productionBatches)
    .values({
      batchNumber: vstup.cislo,
      recipeId: z.recept.id,
      productionDate: vstup.productionDate,
      shift: "ranna",
      machineId: z.stroj.id,
      leadWorkerId: z.pracovnik.id,
      createdBy: z.adminId,
    })
    .returning();

  await vydajNavazky(db, {
    userId: z.adminId,
    batchId: davka.id,
    materialId: z.material.id,
    qty: vstup.vydajKg,
  });
  await db.insert(s.batchLabor).values({
    batchId: davka.id,
    workerId: z.pracovnik.id,
    workDate: vstup.productionDate,
    hours: vstup.pracaHodiny,
    hourlyRateCents: vstup.pracaSadzbaCents,
    createdBy: z.adminId,
  });
  await odovzdajNaLabak(db, {
    userId: z.adminId,
    batchId: davka.id,
    outputKg: vstup.outputKg,
  });
  if (vstup.schvalit !== false) {
    const { test } = await zapisMerania(db, {
      userId: z.adminId,
      batchId: davka.id,
      merania: [{ parameterId: lz.parametre["TVRDOST"].id, value: "60" }],
    });
    await vynesVerdikt(db, {
      userId: z.adminId,
      labTestId: test.id,
      verdict: "schvalene",
    });
  }
  const [po] = await db
    .select()
    .from(s.productionBatches)
    .where(eq(s.productionBatches.id, davka.id));
  return po;
}

export type VyrobaJun = {
  d1: typeof schema.productionBatches.$inferSelect;
  d2: typeof schema.productionBatches.$inferSelect;
  lot: { id: string };
};

/** Sklad + júnové dávky D1/D2 podľa ručného prepočtu. */
export async function seedVyrobaJun(
  db: TestDb,
  z: Zaklad,
  lz: LisovnaZaklad,
): Promise<VyrobaJun> {
  const prijem = await pociatocnyStav(db, {
    userId: z.adminId,
    receiptNumber: "P-CALC-1",
    receivedAt: "2026-06-01",
    polozky: [
      { materialId: z.material.id, qty: "500.000", unitPrice: "45.3500" },
    ],
  });
  const d1 = await pripravDavkuSNakladmi(db, z, lz, {
    cislo: "V-2026-0101",
    productionDate: "2026-06-10",
    vydajKg: "50.000",
    pracaHodiny: "2.00",
    pracaSadzbaCents: 1000,
    outputKg: "100.000",
  });
  const d2 = await pripravDavkuSNakladmi(db, z, lz, {
    cislo: "V-2026-0102",
    productionDate: "2026-06-20",
    vydajKg: "30.000",
    pracaHodiny: "1.50",
    pracaSadzbaCents: 1200,
    outputKg: "60.000",
  });
  return { d1, d2, lot: prijem.loty[0] };
}

export type LisovnaJun = {
  prikaz: typeof schema.workOrders.$inferSelect;
};

/** Júnový príkaz P1 s výkonmi R1+R2, prácou a orezom (viď hlavička). */
export async function seedLisovnaJun(
  db: TestDb,
  z: Zaklad,
  lz: LisovnaZaklad,
  kz: KalkZaklad,
  vyroba: VyrobaJun,
): Promise<LisovnaJun> {
  const prikaz = await zalozPrikaz(db, {
    userId: z.adminId,
    soleModelId: kz.artikel.id,
    qtyPairsPlanned: 500,
  });
  await zapisVykon(db, {
    userId: z.adminId,
    workOrderId: prikaz.id,
    machineId: lz.lis.id,
    batchId: vyroba.d1.id,
    runDate: "2026-06-12",
    shift: "ranna",
    cyclesCount: 120,
    pairsProduced: 230,
    mixtureKg: "60.000",
    workerId: z.pracovnik.id,
    nepodarky: [{ defectReasonId: lz.dovod.id, qtyPairs: 7 }],
  });
  await zapisVykon(db, {
    userId: z.adminId,
    workOrderId: prikaz.id,
    machineId: lz.lis.id,
    batchId: vyroba.d2.id,
    runDate: "2026-06-22",
    shift: "poobedna",
    cyclesCount: 80,
    pairsProduced: 150,
    mixtureKg: "40.000",
    workerId: z.pracovnik.id,
  });
  await db.insert(s.workOrderLabor).values({
    workOrderId: prikaz.id,
    workerId: z.pracovnik.id,
    workDate: "2026-06-23",
    hours: "3.00",
    hourlyRateCents: 900,
    createdBy: z.adminId,
  });
  await zapisOrez(db, {
    userId: z.adminId,
    workOrderId: prikaz.id,
    qtyKg: "5.000",
    recordDate: "2026-06-25",
  });
  return { prikaz };
}
