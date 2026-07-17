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

export const suppliers = pgTable(
  "suppliers",
  {
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
  },
  (t) => [
    // Kľúče zhodné s D10 importom: IČO, inak názov (case/trim-insensitive).
    uniqueIndex("suppliers_ico_uq")
      .on(t.ico)
      .where(sql`deleted_at IS NULL AND ico IS NOT NULL AND ico <> ''`),
    uniqueIndex("suppliers_name_uq")
      .on(sql`lower(trim("name"))`)
      .where(sql`deleted_at IS NULL`),
  ],
);

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
    // F3: kedy bola faktúra naposledy vyexportovaná do MRP (NULL = nikdy).
    mrpExportedAt: timestamp("mrp_exported_at", { withTimezone: true }),
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
    // Najviac JEDNO rozpracované meranie (bez verdiktu) na dávku — DB backstop
    // proti súbehu dvoch zápisov (app-level SELECT check nie je pod READ COMMITTED
    // atomický). Pri porušení vznikne 23505 → retry v zapisMerania hodí slovenskú
    // hlášku „Dávka už má rozpracované meranie bez verdiktu".
    uniqueIndex("lab_tests_one_open_per_batch_uq")
      .on(t.batchId)
      .where(sql`verdict IS NULL AND deleted_at IS NULL`),
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

// ───────────────────────────────────── M6 — lisovňa (podošvy) ──

// Číselník dôvodov nepodarkov (SPEC M6). Bez CRUD UI — seed, ako downtime_reasons.
export const defectReasons = pgTable(
  "defect_reasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...audit(),
  },
  (t) => [
    uniqueIndex("defect_reasons_code_uq")
      .on(t.code)
      .where(sql`deleted_at IS NULL`),
  ],
);

// Katalóg artiklov: artikel = model podošvy, jednotka = pár (D7 — žiadne
// veľkostné čísla). Norma spotreby zmesi na pár = vstup teoretickej kalkulácie,
// predajná cena = vstup marže (M7). target_cycle_seconds je zo zadania
// (budúce KPI taktu), nie zo SPEC — preto nullable.
export const soleModels = pgTable(
  "sole_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    // Zmena zmesi pri živých príkazoch blokovaná DB triggerom (custom migrácia).
    mixtureId: uuid("mixture_id")
      .notNull()
      .references(() => mixtures.id),
    mixtureKgPerPair: numeric("mixture_kg_per_pair", {
      precision: 12,
      scale: 3,
    }).notNull(),
    targetCycleSeconds: integer("target_cycle_seconds"),
    salePriceCents: integer("sale_price_cents"),
    isActive: boolean("is_active").notNull().default(true),
    ...audit(),
  },
  (t) => [
    uniqueIndex("sole_models_code_uq")
      .on(t.code)
      .where(sql`deleted_at IS NULL`),
    check("sole_models_kg_per_pair_positive", sql`mixture_kg_per_pair > 0`),
    check(
      "sole_models_cycle_positive",
      sql`target_cycle_seconds IS NULL OR target_cycle_seconds > 0`,
    ),
    check(
      "sole_models_price_positive",
      sql`sale_price_cents IS NULL OR sale_price_cents > 0`,
    ),
  ],
);

// order_number generuje systém: PR-RRRR-NNNN (poradové číslo per rok, app logika).
// Stavový automat (DB trigger guard v custom migrácii): nova → vo_vyrobe |
// zrusena; vo_vyrobe → dokoncena; dokoncena → vo_vyrobe (reopen na opravy).
// prep_branch = výber vetvy prípravy zmesi (SPEC M6 krok 2: Barwell / sekanie).
// DECISION-PENDING: kroky zapravovanie/kontrola/balenie sa neevidujú ako
// samostatné záznamy — lisovanie pokrývajú press_runs, orez scrap_records,
// výstupná kontrola je zahrnutá v sémantike pairs_produced (= dobré páry).
export const workOrders = pgTable(
  "work_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNumber: text("order_number").notNull(),
    // Zmena artiklu pri živých výkonoch/expedícii blokovaná DB triggerom.
    soleModelId: uuid("sole_model_id")
      .notNull()
      .references(() => soleModels.id),
    qtyPairsPlanned: integer("qty_pairs_planned").notNull(),
    // text + CHECK namiesto enumu — hodnoty sa menia obyčajnou migráciou.
    status: text("status").notNull().default("nova"),
    prepBranch: text("prep_branch"),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    uniqueIndex("work_orders_number_uq")
      .on(t.orderNumber)
      .where(sql`deleted_at IS NULL`),
    check("work_orders_qty_positive", sql`qty_pairs_planned > 0`),
    check(
      "work_orders_status_allowed",
      sql`status IN ('nova', 'vo_vyrobe', 'dokoncena', 'zrusena')`,
    ),
    check(
      "work_orders_prep_branch_allowed",
      sql`prep_branch IS NULL OR prep_branch IN ('barwell', 'sekanie')`,
    ),
    index("work_orders_status_idx").on(t.status),
    index("work_orders_sole_model_idx").on(t.soleModelId),
  ],
);

// Práca lisovne (lisovanie, orez, zapravenie, balenie) per príkaz — vstup
// nákladu na pár (SPEC M7). Zrkadlo batch_labor.
export const workOrderLabor = pgTable(
  "work_order_labor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => workers.id),
    workDate: date("work_date").notNull(),
    hours: numeric("hours", { precision: 6, scale: 2 }).notNull(),
    // Snapshot z labor_rates k work_date — zmena sadzby neprepíše históriu.
    hourlyRateCents: integer("hourly_rate_cents").notNull(),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    check("work_order_labor_hours_positive", sql`hours > 0`),
    check("work_order_labor_rate_positive", sql`hourly_rate_cents > 0`),
    index("work_order_labor_order_idx").on(t.workOrderId),
  ],
);

// Výkon per lis a zmena (LIS1–LIS9 + STREKOLIS). TVRDÁ VÄZBA na schválenú
// zmes (SPEC §12): batch_id smie odkazovať len dávku v stave 'schvalena' —
// vynucuje DB trigger (custom migrácia) + app vrstva; trigger stráži aj zhodu
// zmesi s artiklom, rozpočet Σ mixture_kg ≤ output_kg a immutabilitu väzieb.
// pairs_produced = DOBRÉ páry po výstupnej kontrole; nepodarky zvlášť
// (press_run_defects). cycles_count = alokačný kľúč réžií lisovne (D2).
export const pressRuns = pgTable(
  "press_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id),
    machineId: uuid("machine_id")
      .notNull()
      .references(() => machines.id),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => productionBatches.id),
    runDate: date("run_date").notNull(),
    // text + CHECK namiesto enumu — hodnoty sa menia obyčajnou migráciou.
    shift: text("shift").notNull(),
    cyclesCount: integer("cycles_count").notNull(),
    pairsProduced: integer("pairs_produced").notNull(),
    mixtureKg: numeric("mixture_kg", { precision: 12, scale: 3 }).notNull(),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => workers.id),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    check(
      "press_runs_shift_allowed",
      sql`shift IN ('ranna', 'poobedna', 'nocna')`,
    ),
    check("press_runs_cycles_positive", sql`cycles_count > 0`),
    check("press_runs_pairs_nonnegative", sql`pairs_produced >= 0`),
    check("press_runs_kg_positive", sql`mixture_kg > 0`),
    index("press_runs_order_idx").on(t.workOrderId),
    index("press_runs_batch_idx").on(t.batchId),
  ],
);

// Nepodarky per výkon s dôvodom z číselníka (SPEC M6).
export const pressRunDefects = pgTable(
  "press_run_defects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pressRunId: uuid("press_run_id")
      .notNull()
      .references(() => pressRuns.id),
    defectReasonId: uuid("defect_reason_id")
      .notNull()
      .references(() => defectReasons.id),
    qtyPairs: integer("qty_pairs").notNull(),
    ...audit(),
  },
  (t) => [
    check("press_run_defects_qty_positive", sql`qty_pairs > 0`),
    // Dôvod max raz per výkon — množstvo sa edituje, neduplikuje.
    uniqueIndex("press_run_defects_run_reason_uq")
      .on(t.pressRunId, t.defectReasonId)
      .where(sql`deleted_at IS NULL`),
  ],
);

// Prestoje per výkon (SPEC M6) — existujúci číselník downtime_reasons.
export const pressRunDowntimes = pgTable(
  "press_run_downtimes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pressRunId: uuid("press_run_id")
      .notNull()
      .references(() => pressRuns.id),
    reasonId: uuid("reason_id")
      .notNull()
      .references(() => downtimeReasons.id),
    minutes: integer("minutes").notNull(),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    check("press_run_downtimes_minutes_positive", sql`minutes > 0`),
    index("press_run_downtimes_run_idx").on(t.pressRunId),
  ],
);

// Pretoky / orez per príkaz (D5: likvidácia = 100 % strata; kg = KPI
// odpadovosti pre M8 dashboard).
export const scrapRecords = pgTable(
  "scrap_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id),
    qtyKg: numeric("qty_kg", { precision: 12, scale: 3 }).notNull(),
    recordDate: date("record_date").notNull(),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    check("scrap_records_kg_positive", sql`qty_kg > 0`),
    index("scrap_records_order_idx").on(t.workOrderId),
  ],
);

// Expedícia: dodací list (DL-RRRR-NNNN, app logika). Odberateľ ako text
// s UI prefillom „LOWA" — customers tabuľka nie je v SPEC §6.
export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentNumber: text("shipment_number").notNull(),
    shipDate: date("ship_date").notNull(),
    customer: text("customer").notNull(),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    uniqueIndex("shipments_number_uq")
      .on(t.shipmentNumber)
      .where(sql`deleted_at IS NULL`),
  ],
);

// Položka DL viazaná na výrobný príkaz → traceabilita dodávka → príkaz →
// dávky (press_runs) → šarže surovín. Σ expedovaných párov per príkaz ≤
// Σ pairs_produced stráži DB trigger (sklad hotových nejde do mínusu).
export const shipmentItems = pgTable(
  "shipment_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id),
    qtyPairs: integer("qty_pairs").notNull(),
    ...audit(),
  },
  (t) => [
    check("shipment_items_qty_positive", sql`qty_pairs > 0`),
    uniqueIndex("shipment_items_shipment_order_uq")
      .on(t.shipmentId, t.workOrderId)
      .where(sql`deleted_at IS NULL`),
    index("shipment_items_order_idx").on(t.workOrderId),
  ],
);

// ───────────────────────────── M7 — kalkulácie a uzávierky ──

// Uzamknutie mesiaca (SPEC M7, workflow 5). Živý riadok = uzavretý mesiac;
// reopen = soft delete (len admin a len posledná živá uzávierka — app guard
// v close.ts). Doklady uzavretého mesiaca zamyká assert_period_open (0007).
export const periodCloses = pgTable(
  "period_closes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Vždy 1. deň mesiaca (CHECK) — kanonická identifikácia obdobia.
    period: date("period").notNull(),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    uniqueIndex("period_closes_period_uq")
      .on(t.period)
      .where(sql`deleted_at IS NULL`),
    check(
      "period_closes_first_of_month",
      sql`period = date_trunc('month', period)::date`,
    ),
  ],
);

// Archív alokácií réžií per uzávierka × stredisko (SPEC §6). pool_cents =
// réžie strediska za mesiac (faktúry réžia+služby, energia podľa D4 60/40,
// cost_corrections). basis/rate podľa D2 kľúča strediska:
//   valcovňa: kg vyrobenej zmesi → sadzba c/kg,
//   lisovňa:  lisovacie cykly    → sadzba c/cyklus,
//   labák:    priame náklady dávok (centy) → prirážka v %,
//   správa:   výrobné náklady mesiaca (centy) → prirážka v %.
// Sadzba na 6 des. miest (half-up); alokácia na doklad = round(základ ×
// sadzba) RAZ — ručne prepočítateľné (SPEC §12). Riadky sa nemažú; reopen
// soft-deletne uzávierku a archív ostáva na nej.
export const overheadAllocations = pgTable(
  "overhead_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodCloseId: uuid("period_close_id")
      .notNull()
      .references(() => periodCloses.id),
    costCenterId: uuid("cost_center_id")
      .notNull()
      .references(() => costCenters.id),
    // Záporný pool = dobropisy prevýšili réžie (povolené, sadzba záporná).
    poolCents: integer("pool_cents").notNull(),
    basis: numeric("basis", { precision: 16, scale: 3 }).notNull(),
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    ...audit(),
  },
  (t) => [
    uniqueIndex("overhead_allocations_close_center_uq").on(
      t.periodCloseId,
      t.costCenterId,
    ),
    check("overhead_allocations_basis_nonnegative", sql`basis >= 0`),
  ],
);

// Alokačné nastavenia (SPEC §4: alokačné kľúče spravuje admin). Jediný živý
// riadok code='default'. D4: fixný pomer inštalovaného príkonu valcovňa/
// lisovňa na delenie mesačnej faktúry za energie (schválené 60/40).
export const calcSettings = pgTable(
  "calc_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().default("default"),
    energyValcovnaPct: integer("energy_valcovna_pct").notNull(),
    energyLisovnaPct: integer("energy_lisovna_pct").notNull(),
    ...audit(),
  },
  (t) => [
    uniqueIndex("calc_settings_code_uq")
      .on(t.code)
      .where(sql`deleted_at IS NULL`),
    check(
      "calc_settings_pct_range",
      sql`energy_valcovna_pct BETWEEN 0 AND 100 AND energy_lisovna_pct BETWEEN 0 AND 100`,
    ),
    check(
      "calc_settings_pct_sum",
      sql`energy_valcovna_pct + energy_lisovna_pct = 100`,
    ),
  ],
);

// Dopad cenových korekcií dokladov do UZAVRETÝCH období (corrections.ts):
// snapshoty pohybov uzavretého mesiaca sa neprepisujú — cenový rozdiel sa
// zaúčtuje sem, do réžií strediska v period_date (aktuálny otvorený mesiac),
// a vstúpi do poolu pri jeho uzávierke. Oprava omylu = protizáznam, nie edit.
export const costCorrections = pgTable(
  "cost_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => materialLots.id),
    costCenterId: uuid("cost_center_id")
      .notNull()
      .references(() => costCenters.id),
    // Vždy 1. deň mesiaca (CHECK); otvorenosť mesiaca stráži trigger (0007).
    periodDate: date("period_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    note: text("note"),
    ...audit(),
  },
  (t) => [
    check("cost_corrections_amount_nonzero", sql`amount_cents <> 0`),
    check(
      "cost_corrections_first_of_month",
      sql`period_date = date_trunc('month', period_date)::date`,
    ),
    index("cost_corrections_period_idx").on(t.periodDate),
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
