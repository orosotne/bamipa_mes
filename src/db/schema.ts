// src/db/schema.ts
// F1 schéma (M1–M5 + základný náklad/kg) podľa schváleného návrhu.
// Zdroj pravdy: SPEC.md + DECISIONS.md (D1 FIFO per šarža, D4 energie=réžia,
// D6 recepty v kg na štandardnú dávku, D8 tablet-first).
//
// Konvencie:
// - SUMY peňazí: integer centy. JEDNOTKOVÉ SADZBY: numeric(14,4) centov —
//   celocentová sadzba nedokáže reprezentovať cenníkové ceny surovín
//   (napr. 0,4535 €/kg) a súčet výdajok by nesadol na fakturovanú sumu.
// - Množstvá: numeric(12,3) kg; hodiny numeric(6,2); lab hodnoty numeric(10,3).
// - Audit stĺpce všade (výnimky deklarované pri tabuľkách).
// - Soft delete: partial unique indexy WHERE deleted_at IS NULL.
// - Všetky FK: ON DELETE RESTRICT (Drizzle default NO ACTION) — dokladová
//   reťaz sa nesmie dať pretrhnúť.
// - RLS + DB triggre (QC brána, append-only kniha, nemennosť receptov,
//   qty_remaining) sú v custom migrácii — Drizzle ich nemodeluje.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────── enumy ──

export const userRole = pgEnum("user_role", [
  "admin",
  "ekonom",
  "majster_valcovne",
  "laborant",
  "majster_lisovne",
]);

export const invoiceStatus = pgEnum("invoice_status", [
  "nova",
  "schvalena",
  "ciastocne_zaplatena",
  "zaplatena",
]);

export const invoiceCategory = pgEnum("invoice_category", [
  "material",
  "energia",
  "sluzby",
  "investicia",
  "rezia",
]);

export const materialUnit = pgEnum("material_unit", ["kg", "l", "ks"]);

// Vedome enum (nie číselník): nová kategória = migrácia ADD VALUE, "ine" je záchyt.
export const materialCategory = pgEnum("material_category", [
  "kaucuk",
  "plnivo",
  "olej",
  "chemikalia",
  "obalovy_material",
  "ine",
]);

export const receiptSource = pgEnum("receipt_source", [
  "faktura",
  "pociatocny_stav",
  "ine",
]);

export const stockMoveType = pgEnum("stock_move_type", [
  "prijem",
  "vydaj",
  "korekcia",
]);

export const batchStatus = pgEnum("batch_status", [
  "rozpracovana",
  "caka_na_labak",
  "schvalena",
  "zamietnuta",
]);

// PODMIENEČNE vedome vynechané z F1 (rozhodnutie z návrhu; ADD VALUE kedykoľvek).
export const labVerdict = pgEnum("lab_verdict", ["schvalene", "zamietnute"]);

// ──────────────────────────────────────────────────────────────── users ──

// id BEZ defaultu = Supabase auth.users.id. Bootstrap: prvý admin sa založí
// v Supabase Auth a jeho auth id sa použije ako users.id; až potom seedy
// číselníkov (vyžadujú created_by). Rola ako enum je vedomá odchýlka od
// SPEC §6 (users+roles) — 5 fixných rolí zo SPEC §4.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    role: userRole("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
    // NULL len pre bootstrap admina.
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_email_uq")
      .on(t.email)
      .where(sql`deleted_at IS NULL`),
  ],
);

// Spoločné audit stĺpce (za users, aby helper mohol referencovať users.id).
const audit = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
    () => new Date(),
  ),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// Append-only variant (stock_moves): bez updated_at/deleted_at.
const auditAppendOnly = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
});

// ─────────────────────────────────────────────────────────── číselníky ──

export const costCenters = pgTable(
  "cost_centers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(), // seed: valcovna, lisovna, labak, sprava
    name: text("name").notNull(),
    ...audit(),
  },
  (t) => [
    uniqueIndex("cost_centers_code_uq")
      .on(t.code)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ico: text("ico"),
  dic: text("dic"),
  icDph: text("ic_dph"),
  address: text("address"),
  email: text("email"),
  phone: text("phone"),
  note: text("note"),
  ...audit(),
});

export const machines = pgTable(
  "machines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    costCenterId: uuid("cost_center_id")
      .notNull()
      .references(() => costCenters.id),
    isActive: boolean("is_active").notNull().default(true),
    ...audit(),
  },
  (t) => [
    uniqueIndex("machines_code_uq")
      .on(t.code)
      .where(sql`deleted_at IS NULL`),
  ],
);

// Pracovníci dielne — nemajú užívateľské účty (D9: ~5–7 účtov, pracovníkov viac).
export const workers = pgTable("workers", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...audit(),
});

export const laborRates = pgTable(
  "labor_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => workers.id),
    hourlyRateCents: integer("hourly_rate_cents").notNull(),
    validFrom: date("valid_from").notNull(),
    ...audit(),
  },
  (t) => [
    uniqueIndex("labor_rates_worker_valid_from_uq")
      .on(t.workerId, t.validFrom)
      .where(sql`deleted_at IS NULL`),
    check("labor_rates_rate_positive", sql`hourly_rate_cents > 0`),
  ],
);

export const downtimeReasons = pgTable(
  "downtime_reasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(), // seed: porucha, cakanie_na_material, prestavba, ine
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...audit(),
  },
  (t) => [
    uniqueIndex("downtime_reasons_code_uq")
      .on(t.code)
      .where(sql`deleted_at IS NULL`),
  ],
);

// ───────────────────────────────────────────────────── M1 — faktúry (AP) ──

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    invoiceNumber: text("invoice_number").notNull(),
    issueDate: date("issue_date"),
    deliveryDate: date("delivery_date"),
    dueDate: date("due_date").notNull(),
    totalNetCents: integer("total_net_cents").notNull(),
    totalVatCents: integer("total_vat_cents").notNull(),
    totalGrossCents: integer("total_gross_cents").notNull(),
    status: invoiceStatus("status").notNull().default("nova"),
    attachmentPath: text("attachment_path"), // Supabase Storage (PDF/foto)
    note: text("note"),
    ...audit(),
  },
  (t) => [
    uniqueIndex("invoices_supplier_number_uq")
      .on(t.supplierId, t.invoiceNumber)
      .where(sql`deleted_at IS NULL`),
    check(
      "invoices_gross_is_net_plus_vat",
      sql`total_gross_cents = total_net_cents + total_vat_cents`,
    ),
    index("invoices_due_date_idx").on(t.dueDate),
  ],
);

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  description: text("description").notNull(),
  category: invoiceCategory("category").notNull(),
  costCenterId: uuid("cost_center_id")
    .notNull()
    .references(() => costCenters.id),
  qty: numeric("qty", { precision: 12, scale: 3 }),
  unit: text("unit"),
  // SADZBA v centoch (numeric — dokladová presnosť, napr. 45,3500 c/kg).
  unitPrice: numeric("unit_price", { precision: 14, scale: 4 }),
  totalNetCents: integer("total_net_cents").notNull(),
  ...audit(),
});

export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    paidAt: date("paid_at").notNull(),
    // Záporné = vedome povolený refund/dobropis platby.
    amountCents: integer("amount_cents").notNull(),
    note: text("note"),
    ...audit(),
  },
  (t) => [check("invoice_payments_amount_nonzero", sql`amount_cents <> 0`)],
);

// ──────────────────────────────────────────── M2 — sklad, šarže, FIFO ──

export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    // Pravidlo jednotiek: materiály v receptúrach MUSIA mať unit='kg'
    // (app guard) — recepty aj navážka sú v kg (D6), schéma nemá konverzie.
    unit: materialUnit("unit").notNull(),
    category: materialCategory("category").notNull(),
    minStockQty: numeric("min_stock_qty", { precision: 12, scale: 3 }),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    uniqueIndex("materials_code_uq")
      .on(t.code)
      .where(sql`deleted_at IS NULL`),
  ],
);

// Vedomá výnimka z konvencie: čistá M2M väzba bez soft delete a updated_at
// (hard delete OK — composite PK by po soft delete blokoval znovupridanie).
export const materialSuppliers = pgTable(
  "material_suppliers",
  {
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.materialId, t.supplierId] })],
);

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptNumber: text("receipt_number").notNull(),
    source: receiptSource("source").notNull().default("faktura"),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    receivedAt: date("received_at").notNull(), // FIFO kľúč (1. úroveň)
    note: text("note"),
    ...audit(),
  },
  (t) => [
    uniqueIndex("receipts_number_uq")
      .on(t.receiptNumber)
      .where(sql`deleted_at IS NULL`),
    check(
      "receipts_faktura_requires_invoice",
      sql`source <> 'faktura' OR invoice_id IS NOT NULL`,
    ),
  ],
);

// Skladové šarže — jadro FIFO (D1).
// Záväzné FIFO poradie: ORDER BY receipts.received_at, receipts.receipt_number,
// material_lots.line_no (deterministické, reprodukovateľné pri ručnom prepočte).
// qty_remaining udržiava VÝHRADNE DB trigger na stock_moves (custom migrácia);
// invariant: qty_remaining = Σ qty_delta všetkých pohybov šarže.
// Horný bound (≤ qty_received) zámerne CHÝBA — inventúrny prebytok (+korekcia)
// ho smie prekročiť (SPEC M2).
export const materialLots = pgTable(
  "material_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipts.id),
    lineNo: integer("line_no").notNull(),
    invoiceItemId: uuid("invoice_item_id").references(() => invoiceItems.id),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    supplierLotCode: text("supplier_lot_code"),
    qtyReceived: numeric("qty_received", { precision: 12, scale: 3 }).notNull(),
    // Lot vzniká s 0; na skutočný stav ho dostane 'prijem' pohyb (trigger).
    qtyRemaining: numeric("qty_remaining", { precision: 12, scale: 3 })
      .notNull()
      .default("0"),
    // SADZBA v centoch (dokladová presnosť).
    unitPrice: numeric("unit_price", { precision: 14, scale: 4 }).notNull(),
    ...audit(),
  },
  (t) => [
    uniqueIndex("material_lots_receipt_line_uq").on(t.receiptId, t.lineNo),
    check("material_lots_qty_received_positive", sql`qty_received > 0`),
    check("material_lots_qty_remaining_nonnegative", sql`qty_remaining >= 0`),
    check("material_lots_unit_price_positive", sql`unit_price > 0`),
    index("material_lots_material_idx").on(t.materialId, t.deletedAt),
  ],
);

// ─────────────────────────────────────── M3 — receptúry (verzované BOM) ──

export const mixtures = pgTable(
  "mixtures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    uniqueIndex("mixtures_code_uq")
      .on(t.code)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mixtureId: uuid("mixture_id")
      .notNull()
      .references(() => mixtures.id),
    version: integer("version").notNull(),
    standardBatchKg: numeric("standard_batch_kg", {
      precision: 12,
      scale: 3,
    }).notNull(),
    techNotes: text("tech_notes"),
    isActive: boolean("is_active").notNull().default(true),
    ...audit(),
  },
  (t) => [
    // Zámerne PLNÝ unique (bez partial): verzie sa nerecyklujú ani po soft
    // delete — dávky ich referencujú.
    uniqueIndex("recipes_mixture_version_uq").on(t.mixtureId, t.version),
    // Max 1 aktívna verzia per zmes; bez deleted_at podmienky by zmazaná
    // aktívna verzia navždy blokovala aktiváciu novej.
    uniqueIndex("recipes_one_active_per_mixture_uq")
      .on(t.mixtureId)
      .where(sql`is_active AND deleted_at IS NULL`),
    check("recipes_standard_batch_positive", sql`standard_batch_kg > 0`),
    check("recipes_version_positive", sql`version > 0`),
  ],
);

// Bez soft delete: verzia receptu, na ktorú existuje dávka, je IMMUTABLE
// (app guard + DB trigger v custom migrácii). "Oprava preklepu" = nová verzia.
// Hard delete položiek len v drafte (verzia bez dávok).
export const recipeItems = pgTable(
  "recipe_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    qtyKg: numeric("qty_kg", { precision: 12, scale: 3 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    uniqueIndex("recipe_items_recipe_material_uq").on(t.recipeId, t.materialId),
    check("recipe_items_qty_positive", sql`qty_kg > 0`),
  ],
);

// ─────────────────────────────────── M4 — výrobné dávky valcovne ──

// batch_number generuje systém: V-RRRR-NNNN (poradové číslo per rok, app logika).
// Stavový automat: rozpracovana → caka_na_labak → schvalena | zamietnuta;
// zamietnuta → caka_na_labak (cez batch_adjustment). Vynucuje app vrstva
// + DB trigger guard (custom migrácia): schvalena/zamietnuta len z
// caka_na_labak a len s existujúcim zodpovedajúcim verdiktom labáku;
// prechod do caka_na_labak vyžaduje output_kg (po reworku znovu potvrdené).
export const productionBatches = pgTable(
  "production_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchNumber: text("batch_number").notNull(),
    // Presná verzia receptu; zmes derivovaná cez recipes (žiadny redundantný FK).
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id),
    status: batchStatus("status").notNull().default("rozpracovana"),
    productionDate: date("production_date").notNull(),
    // text + CHECK namiesto enumu — hodnoty sa menia obyčajnou migráciou.
    shift: text("shift").notNull(),
    machineId: uuid("machine_id")
      .notNull()
      .references(() => machines.id),
    leadWorkerId: uuid("lead_worker_id")
      .notNull()
      .references(() => workers.id),
    // Násobok štandardnej dávky → plán navážky = recipe_items × scale_factor.
    scaleFactor: numeric("scale_factor", { precision: 6, scale: 3 })
      .notNull()
      .default("1"),
    // Finálne skutočné kg po VŠETKÝCH úpravách (menovateľ nákladu/kg).
    outputKg: numeric("output_kg", { precision: 12, scale: 3 }),
    workMinutes: integer("work_minutes"),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    uniqueIndex("production_batches_number_uq")
      .on(t.batchNumber)
      .where(sql`deleted_at IS NULL`),
    check(
      "production_batches_shift_allowed",
      sql`shift IN ('ranna', 'poobedna', 'nocna')`,
    ),
    check("production_batches_scale_positive", sql`scale_factor > 0`),
    check(
      "production_batches_output_positive",
      sql`output_kg IS NULL OR output_kg > 0`,
    ),
    check(
      "production_batches_work_minutes_positive",
      sql`work_minutes IS NULL OR work_minutes > 0`,
    ),
    index("production_batches_status_idx").on(t.status),
    index("production_batches_date_idx").on(t.productionDate),
  ],
);

// ───────────────────────────────────────────── M5 — labák (QC brána) ──

export const labParameters = pgTable(
  "lab_parameters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(), // ML, MH, TS2, T90, PEVNOST, TAZNOST, TVRDOST…
    name: text("name").notNull(),
    unit: text("unit"), // dNm, min, MPa, %, ShA…
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...audit(),
  },
  (t) => [
    uniqueIndex("lab_parameters_code_uq")
      .on(t.code)
      .where(sql`deleted_at IS NULL`),
  ],
);

// Tolerančné limity per zmes (konfigurovateľné QC — žiadne hardcoded stĺpce).
export const labTestDefinitions = pgTable(
  "lab_test_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mixtureId: uuid("mixture_id")
      .notNull()
      .references(() => mixtures.id),
    parameterId: uuid("parameter_id")
      .notNull()
      .references(() => labParameters.id),
    minValue: numeric("min_value", { precision: 10, scale: 3 }),
    maxValue: numeric("max_value", { precision: 10, scale: 3 }),
    isActive: boolean("is_active").notNull().default(true),
    ...audit(),
  },
  (t) => [
    uniqueIndex("lab_test_definitions_mixture_parameter_uq")
      .on(t.mixtureId, t.parameterId)
      .where(sql`deleted_at IS NULL`),
    check(
      "lab_test_definitions_some_limit",
      sql`min_value IS NOT NULL OR max_value IS NOT NULL`,
    ),
    check(
      "lab_test_definitions_min_lte_max",
      sql`min_value IS NULL OR max_value IS NULL OR min_value <= max_value`,
    ),
  ],
);

// Schvaľovací log + rework slučka (viac testov per dávka).
// sequence_no: INSERT … SELECT coalesce(max(sequence_no),0)+1 (vrátane
// zmazaných — unique je plný) v jednej transakcii + retry na 23505.
export const labTests = pgTable(
  "lab_tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => productionBatches.id),
    sequenceNo: integer("sequence_no").notNull(),
    verdict: labVerdict("verdict"),
    verdictBy: uuid("verdict_by").references(() => users.id),
    verdictAt: timestamp("verdict_at", { withTimezone: true }),
    note: text("note"),
    ...audit(), // created_by = laborant, ktorý meral
  },
  (t) => [
    uniqueIndex("lab_tests_batch_sequence_uq").on(t.batchId, t.sequenceNo),
    // Cieľ kompozitnej FK z batch_adjustments — UNIQUE CONSTRAINT (nie index),
    // musí existovať už v CREATE TABLE (drizzle-kit generuje FK pred indexmi).
    unique("lab_tests_id_batch_uq").on(t.id, t.batchId),
    // Verdikt vždy s podpisom a časom, alebo vôbec.
    check(
      "lab_tests_verdict_signed",
      sql`(verdict IS NULL) = (verdict_by IS NULL) AND (verdict IS NULL) = (verdict_at IS NULL)`,
    ),
    check("lab_tests_sequence_positive", sql`sequence_no > 0`),
  ],
);

// Hodnoty meraní + snapshot limitov — zmena limitov neprepíše minulé
// vyhodnotenia. Zdroj SPC trendov per zmes.
export const labResults = pgTable(
  "lab_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labTestId: uuid("lab_test_id")
      .notNull()
      .references(() => labTests.id),
    parameterId: uuid("parameter_id")
      .notNull()
      .references(() => labParameters.id),
    value: numeric("value", { precision: 10, scale: 3 }).notNull(),
    minLimitSnapshot: numeric("min_limit_snapshot", {
      precision: 10,
      scale: 3,
    }),
    maxLimitSnapshot: numeric("max_limit_snapshot", {
      precision: 10,
      scale: 3,
    }),
    isWithinLimits: boolean("is_within_limits").notNull(),
    ...audit(),
  },
  (t) => [
    uniqueIndex("lab_results_test_parameter_uq").on(t.labTestId, t.parameterId),
  ],
);

// ───────────────────────────── rework slučka (M4/M5 — úpravy dávok) ──

// Rework slučka: zoskupuje dodatočné spotreby a prácu jednej úpravy a viaže
// ich na zamietnutý test. UNIQUE(id, batch_id) je cieľ kompozitných FK —
// DB garantuje, že vícenáklady patria správnej dávke.
export const batchAdjustments = pgTable(
  "batch_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => productionBatches.id),
    triggeredByLabTestId: uuid("triggered_by_lab_test_id").notNull(),
    description: text("description"),
    ...audit(),
  },
  (t) => [
    // UNIQUE CONSTRAINT (nie index) — cieľ kompozitných FK musí existovať
    // už v CREATE TABLE, inak ALTER TABLE ADD FOREIGN KEY v migrácii zlyhá
    // (drizzle-kit generuje FK pred CREATE INDEX).
    unique("batch_adjustments_id_batch_uq").on(t.id, t.batchId),
    // Spúšťajúci test musí patriť TEJ ISTEJ dávke (kompozitná FK na
    // lab_tests(id, batch_id)); verdict='zamietnute' overuje app/trigger.
    foreignKey({
      name: "batch_adjustments_lab_test_same_batch_fk",
      columns: [t.triggeredByLabTestId, t.batchId],
      foreignColumns: [labTests.id, labTests.batchId],
    }),
  ],
);

export const batchLabor = pgTable(
  "batch_labor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => productionBatches.id),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => workers.id),
    workDate: date("work_date").notNull(),
    hours: numeric("hours", { precision: 6, scale: 2 }).notNull(),
    // Snapshot z labor_rates k work_date — zmena sadzby neprepíše históriu.
    hourlyRateCents: integer("hourly_rate_cents").notNull(),
    adjustmentId: uuid("adjustment_id"),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    check("batch_labor_hours_positive", sql`hours > 0`),
    check("batch_labor_rate_positive", sql`hourly_rate_cents > 0`),
    index("batch_labor_batch_idx").on(t.batchId),
    // Úprava musí patriť TEJ ISTEJ dávke (NULL adjustment_id = mimo reworku).
    foreignKey({
      name: "batch_labor_adjustment_same_batch_fk",
      columns: [t.adjustmentId, t.batchId],
      foreignColumns: [batchAdjustments.id, batchAdjustments.batchId],
    }),
  ],
);

export const batchDowntimes = pgTable(
  "batch_downtimes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => productionBatches.id),
    reasonId: uuid("reason_id")
      .notNull()
      .references(() => downtimeReasons.id),
    minutes: integer("minutes").notNull(),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    check("batch_downtimes_minutes_positive", sql`minutes > 0`),
    index("batch_downtimes_batch_idx").on(t.batchId),
  ],
);

// ─────────────────────────── kniha pohybov (M2/M4 — riadky spotreby) ──

// APPEND-ONLY (bez updated_at/deleted_at; UPDATE/DELETE blokuje DB trigger).
// Oprava = protipohyb: korekcia s batch_id pôvodnej dávky, kladným qty_delta,
// snapshot cenou pôvodného pohybu a reversed_move_id — náklad dávky sa ZNÍŽI
// a zostatok šarže vráti.
// Invariant: material_lots.qty_remaining = Σ qty_delta všetkých pohybov šarže
// (udržiava DB trigger). Príjem sa DO knihy píše ('prijem' riadok pri založení
// šarže) — kniha je úplná.
export const stockMoves = pgTable(
  "stock_moves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => materialLots.id),
    moveType: stockMoveType("move_type").notNull(),
    // prijem > 0; vydaj < 0; korekcia ≠ 0 (± povolené).
    qtyDelta: numeric("qty_delta", { precision: 12, scale: 3 }).notNull(),
    batchId: uuid("batch_id").references(() => productionBatches.id),
    adjustmentId: uuid("adjustment_id"),
    // Storno ukazuje na stornovaný pohyb — auditná stopa opravy.
    reversedMoveId: uuid("reversed_move_id").references(
      (): AnyPgColumn => stockMoves.id,
    ),
    // Snapshot SADZBY šarže v momente pohybu (centy, dokladová presnosť).
    unitPrice: numeric("unit_price", { precision: 14, scale: 4 }).notNull(),
    // Pre inventúrne korekcie: manko/prebytok ako náklad strediska (SPEC M2).
    costCenterId: uuid("cost_center_id").references(() => costCenters.id),
    note: text("note"),
    ...auditAppendOnly(),
  },
  (t) => [
    check(
      "stock_moves_sign_by_type",
      sql`(move_type = 'prijem' AND qty_delta > 0)
        OR (move_type = 'vydaj' AND qty_delta < 0)
        OR (move_type = 'korekcia' AND qty_delta <> 0)`,
    ),
    check(
      "stock_moves_vydaj_requires_batch",
      sql`move_type <> 'vydaj' OR batch_id IS NOT NULL`,
    ),
    // Korekcia je buď storno navážky (dávka), alebo inventúrny rozdiel
    // (stredisko) — nikdy „do vzduchu".
    check(
      "stock_moves_korekcia_has_target",
      sql`move_type <> 'korekcia' OR batch_id IS NOT NULL OR cost_center_id IS NOT NULL`,
    ),
    // Príjem nikdy nepatrí dávke — inak by falošne vstúpil do nákladu
    // dávky (view počíta VŠETKY pohyby s batch_id).
    check(
      "stock_moves_prijem_without_batch",
      sql`move_type <> 'prijem' OR batch_id IS NULL`,
    ),
    // Úprava (rework) implikuje dávku — kompozitná FK s NULL batch_id
    // by inak prešla (MATCH SIMPLE).
    check(
      "stock_moves_adjustment_requires_batch",
      sql`adjustment_id IS NULL OR batch_id IS NOT NULL`,
    ),
    check("stock_moves_unit_price_positive", sql`unit_price > 0`),
    index("stock_moves_batch_idx").on(t.batchId),
    index("stock_moves_lot_idx").on(t.lotId),
    // Úprava musí patriť TEJ ISTEJ dávke.
    foreignKey({
      name: "stock_moves_adjustment_same_batch_fk",
      columns: [t.adjustmentId, t.batchId],
      foreignColumns: [batchAdjustments.id, batchAdjustments.batchId],
    }),
  ],
);

// ──────────────────────────────────────────────────────────── audit ──

// Append-only; píše app vrstva (server actions) pri mutáciách.
// Nesie aj diff cenových korekcií dokladov (action = 'price_correction').
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    tableName: text("table_name").notNull(),
    recordId: uuid("record_id").notNull(),
    action: text("action").notNull(), // insert/update/delete/status_change/price_correction
    changedBy: uuid("changed_by")
      .notNull()
      .references(() => users.id),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    changes: jsonb("changes"),
  },
  (t) => [index("audit_log_record_idx").on(t.tableName, t.recordId)],
);
