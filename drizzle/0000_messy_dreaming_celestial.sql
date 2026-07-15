CREATE TYPE "public"."batch_status" AS ENUM('rozpracovana', 'caka_na_labak', 'schvalena', 'zamietnuta');--> statement-breakpoint
CREATE TYPE "public"."invoice_category" AS ENUM('material', 'energia', 'sluzby', 'investicia', 'rezia');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('nova', 'schvalena', 'ciastocne_zaplatena', 'zaplatena');--> statement-breakpoint
CREATE TYPE "public"."lab_verdict" AS ENUM('schvalene', 'zamietnute');--> statement-breakpoint
CREATE TYPE "public"."material_category" AS ENUM('kaucuk', 'plnivo', 'olej', 'chemikalia', 'obalovy_material', 'ine');--> statement-breakpoint
CREATE TYPE "public"."material_unit" AS ENUM('kg', 'l', 'ks');--> statement-breakpoint
CREATE TYPE "public"."receipt_source" AS ENUM('faktura', 'pociatocny_stav', 'ine');--> statement-breakpoint
CREATE TYPE "public"."stock_move_type" AS ENUM('prijem', 'vydaj', 'korekcia');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'ekonom', 'majster_valcovne', 'laborant', 'majster_lisovne');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"action" text NOT NULL,
	"changed_by" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changes" jsonb
);
--> statement-breakpoint
CREATE TABLE "batch_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"triggered_by_lab_test_id" uuid NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "batch_adjustments_id_batch_uq" UNIQUE("id","batch_id")
);
--> statement-breakpoint
CREATE TABLE "batch_downtimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"reason_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "batch_downtimes_minutes_positive" CHECK (minutes > 0)
);
--> statement-breakpoint
CREATE TABLE "batch_labor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"hourly_rate_cents" integer NOT NULL,
	"adjustment_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "batch_labor_hours_positive" CHECK (hours > 0),
	CONSTRAINT "batch_labor_rate_positive" CHECK (hourly_rate_cents > 0)
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "downtime_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"category" "invoice_category" NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"qty" numeric(12, 3),
	"unit" text,
	"unit_price" numeric(14, 4),
	"total_net_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"paid_at" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invoice_payments_amount_nonzero" CHECK (amount_cents <> 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"issue_date" date,
	"delivery_date" date,
	"due_date" date NOT NULL,
	"total_net_cents" integer NOT NULL,
	"total_vat_cents" integer NOT NULL,
	"total_gross_cents" integer NOT NULL,
	"status" "invoice_status" DEFAULT 'nova' NOT NULL,
	"attachment_path" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invoices_gross_is_net_plus_vat" CHECK (total_gross_cents = total_net_cents + total_vat_cents)
);
--> statement-breakpoint
CREATE TABLE "lab_parameters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_test_id" uuid NOT NULL,
	"parameter_id" uuid NOT NULL,
	"value" numeric(10, 3) NOT NULL,
	"min_limit_snapshot" numeric(10, 3),
	"max_limit_snapshot" numeric(10, 3),
	"is_within_limits" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lab_test_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mixture_id" uuid NOT NULL,
	"parameter_id" uuid NOT NULL,
	"min_value" numeric(10, 3),
	"max_value" numeric(10, 3),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "lab_test_definitions_some_limit" CHECK (min_value IS NOT NULL OR max_value IS NOT NULL),
	CONSTRAINT "lab_test_definitions_min_lte_max" CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);
--> statement-breakpoint
CREATE TABLE "lab_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"sequence_no" integer NOT NULL,
	"verdict" "lab_verdict",
	"verdict_by" uuid,
	"verdict_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "lab_tests_id_batch_uq" UNIQUE("id","batch_id"),
	CONSTRAINT "lab_tests_verdict_signed" CHECK ((verdict IS NULL) = (verdict_by IS NULL) AND (verdict IS NULL) = (verdict_at IS NULL)),
	CONSTRAINT "lab_tests_sequence_positive" CHECK (sequence_no > 0)
);
--> statement-breakpoint
CREATE TABLE "labor_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"hourly_rate_cents" integer NOT NULL,
	"valid_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "labor_rates_rate_positive" CHECK (hourly_rate_cents > 0)
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "material_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"invoice_item_id" uuid,
	"material_id" uuid NOT NULL,
	"supplier_lot_code" text,
	"qty_received" numeric(12, 3) NOT NULL,
	"qty_remaining" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit_price" numeric(14, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "material_lots_qty_received_positive" CHECK (qty_received > 0),
	CONSTRAINT "material_lots_qty_remaining_nonnegative" CHECK (qty_remaining >= 0),
	CONSTRAINT "material_lots_unit_price_positive" CHECK (unit_price > 0)
);
--> statement-breakpoint
CREATE TABLE "material_suppliers" (
	"material_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "material_suppliers_material_id_supplier_id_pk" PRIMARY KEY("material_id","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit" "material_unit" NOT NULL,
	"category" "material_category" NOT NULL,
	"min_stock_qty" numeric(12, 3),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mixtures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "production_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_number" text NOT NULL,
	"recipe_id" uuid NOT NULL,
	"status" "batch_status" DEFAULT 'rozpracovana' NOT NULL,
	"production_date" date NOT NULL,
	"shift" text NOT NULL,
	"machine_id" uuid NOT NULL,
	"lead_worker_id" uuid NOT NULL,
	"scale_factor" numeric(6, 3) DEFAULT '1' NOT NULL,
	"output_kg" numeric(12, 3),
	"work_minutes" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "production_batches_shift_allowed" CHECK (shift IN ('ranna', 'poobedna', 'nocna')),
	CONSTRAINT "production_batches_scale_positive" CHECK (scale_factor > 0),
	CONSTRAINT "production_batches_output_positive" CHECK (output_kg IS NULL OR output_kg > 0),
	CONSTRAINT "production_batches_work_minutes_positive" CHECK (work_minutes IS NULL OR work_minutes > 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_number" text NOT NULL,
	"source" "receipt_source" DEFAULT 'faktura' NOT NULL,
	"invoice_id" uuid,
	"received_at" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "receipts_faktura_requires_invoice" CHECK (source <> 'faktura' OR invoice_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "recipe_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"qty_kg" numeric(12, 3) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "recipe_items_qty_positive" CHECK (qty_kg > 0)
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mixture_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"standard_batch_kg" numeric(12, 3) NOT NULL,
	"tech_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recipes_standard_batch_positive" CHECK (standard_batch_kg > 0),
	CONSTRAINT "recipes_version_positive" CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"move_type" "stock_move_type" NOT NULL,
	"qty_delta" numeric(12, 3) NOT NULL,
	"batch_id" uuid,
	"adjustment_id" uuid,
	"reversed_move_id" uuid,
	"unit_price" numeric(14, 4) NOT NULL,
	"cost_center_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "stock_moves_sign_by_type" CHECK ((move_type = 'prijem' AND qty_delta > 0)
        OR (move_type = 'vydaj' AND qty_delta < 0)
        OR (move_type = 'korekcia' AND qty_delta <> 0)),
	CONSTRAINT "stock_moves_vydaj_requires_batch" CHECK (move_type <> 'vydaj' OR batch_id IS NOT NULL),
	CONSTRAINT "stock_moves_korekcia_has_target" CHECK (move_type <> 'korekcia' OR batch_id IS NOT NULL OR cost_center_id IS NOT NULL),
	CONSTRAINT "stock_moves_prijem_without_batch" CHECK (move_type <> 'prijem' OR batch_id IS NULL),
	CONSTRAINT "stock_moves_adjustment_requires_batch" CHECK (adjustment_id IS NULL OR batch_id IS NOT NULL),
	CONSTRAINT "stock_moves_unit_price_positive" CHECK (unit_price > 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ico" text,
	"dic" text,
	"ic_dph" text,
	"address" text,
	"email" text,
	"phone" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_adjustments" ADD CONSTRAINT "batch_adjustments_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_adjustments" ADD CONSTRAINT "batch_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_adjustments" ADD CONSTRAINT "batch_adjustments_lab_test_same_batch_fk" FOREIGN KEY ("triggered_by_lab_test_id","batch_id") REFERENCES "public"."lab_tests"("id","batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_downtimes" ADD CONSTRAINT "batch_downtimes_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_downtimes" ADD CONSTRAINT "batch_downtimes_reason_id_downtime_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."downtime_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_downtimes" ADD CONSTRAINT "batch_downtimes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_labor" ADD CONSTRAINT "batch_labor_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_labor" ADD CONSTRAINT "batch_labor_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_labor" ADD CONSTRAINT "batch_labor_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_labor" ADD CONSTRAINT "batch_labor_adjustment_same_batch_fk" FOREIGN KEY ("adjustment_id","batch_id") REFERENCES "public"."batch_adjustments"("id","batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtime_reasons" ADD CONSTRAINT "downtime_reasons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_parameters" ADD CONSTRAINT "lab_parameters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_lab_test_id_lab_tests_id_fk" FOREIGN KEY ("lab_test_id") REFERENCES "public"."lab_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_parameter_id_lab_parameters_id_fk" FOREIGN KEY ("parameter_id") REFERENCES "public"."lab_parameters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_definitions" ADD CONSTRAINT "lab_test_definitions_mixture_id_mixtures_id_fk" FOREIGN KEY ("mixture_id") REFERENCES "public"."mixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_definitions" ADD CONSTRAINT "lab_test_definitions_parameter_id_lab_parameters_id_fk" FOREIGN KEY ("parameter_id") REFERENCES "public"."lab_parameters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_definitions" ADD CONSTRAINT "lab_test_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_verdict_by_users_id_fk" FOREIGN KEY ("verdict_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_rates" ADD CONSTRAINT "labor_rates_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_rates" ADD CONSTRAINT "labor_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_invoice_item_id_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_suppliers" ADD CONSTRAINT "material_suppliers_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_suppliers" ADD CONSTRAINT "material_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_suppliers" ADD CONSTRAINT "material_suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixtures" ADD CONSTRAINT "mixtures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_lead_worker_id_workers_id_fk" FOREIGN KEY ("lead_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_mixture_id_mixtures_id_fk" FOREIGN KEY ("mixture_id") REFERENCES "public"."mixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_reversed_move_id_stock_moves_id_fk" FOREIGN KEY ("reversed_move_id") REFERENCES "public"."stock_moves"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_adjustment_same_batch_fk" FOREIGN KEY ("adjustment_id","batch_id") REFERENCES "public"."batch_adjustments"("id","batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_record_idx" ON "audit_log" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "batch_downtimes_batch_idx" ON "batch_downtimes" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "batch_labor_batch_idx" ON "batch_labor" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centers_code_uq" ON "cost_centers" USING btree ("code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "downtime_reasons_code_uq" ON "downtime_reasons" USING btree ("code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_supplier_number_uq" ON "invoices" USING btree ("supplier_id","invoice_number") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "invoices_due_date_idx" ON "invoices" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_parameters_code_uq" ON "lab_parameters" USING btree ("code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lab_results_test_parameter_uq" ON "lab_results" USING btree ("lab_test_id","parameter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_test_definitions_mixture_parameter_uq" ON "lab_test_definitions" USING btree ("mixture_id","parameter_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lab_tests_batch_sequence_uq" ON "lab_tests" USING btree ("batch_id","sequence_no");--> statement-breakpoint
CREATE UNIQUE INDEX "labor_rates_worker_valid_from_uq" ON "labor_rates" USING btree ("worker_id","valid_from") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "machines_code_uq" ON "machines" USING btree ("code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "material_lots_receipt_line_uq" ON "material_lots" USING btree ("receipt_id","line_no");--> statement-breakpoint
CREATE INDEX "material_lots_material_idx" ON "material_lots" USING btree ("material_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_code_uq" ON "materials" USING btree ("code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mixtures_code_uq" ON "mixtures" USING btree ("code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "production_batches_number_uq" ON "production_batches" USING btree ("batch_number") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "production_batches_status_idx" ON "production_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "production_batches_date_idx" ON "production_batches" USING btree ("production_date");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_number_uq" ON "receipts" USING btree ("receipt_number") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_items_recipe_material_uq" ON "recipe_items" USING btree ("recipe_id","material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_mixture_version_uq" ON "recipes" USING btree ("mixture_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_one_active_per_mixture_uq" ON "recipes" USING btree ("mixture_id") WHERE is_active AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "stock_moves_batch_idx" ON "stock_moves" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stock_moves_lot_idx" ON "stock_moves" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email") WHERE deleted_at IS NULL;