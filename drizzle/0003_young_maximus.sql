CREATE TABLE "defect_reasons" (
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
CREATE TABLE "press_run_defects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"press_run_id" uuid NOT NULL,
	"defect_reason_id" uuid NOT NULL,
	"qty_pairs" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "press_run_defects_qty_positive" CHECK (qty_pairs > 0)
);
--> statement-breakpoint
CREATE TABLE "press_run_downtimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"press_run_id" uuid NOT NULL,
	"reason_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "press_run_downtimes_minutes_positive" CHECK (minutes > 0)
);
--> statement-breakpoint
CREATE TABLE "press_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"run_date" date NOT NULL,
	"shift" text NOT NULL,
	"cycles_count" integer NOT NULL,
	"pairs_produced" integer NOT NULL,
	"mixture_kg" numeric(12, 3) NOT NULL,
	"worker_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "press_runs_shift_allowed" CHECK (shift IN ('ranna', 'poobedna', 'nocna')),
	CONSTRAINT "press_runs_cycles_positive" CHECK (cycles_count > 0),
	CONSTRAINT "press_runs_pairs_nonnegative" CHECK (pairs_produced >= 0),
	CONSTRAINT "press_runs_kg_positive" CHECK (mixture_kg > 0)
);
--> statement-breakpoint
CREATE TABLE "scrap_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"qty_kg" numeric(12, 3) NOT NULL,
	"record_date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "scrap_records_kg_positive" CHECK (qty_kg > 0)
);
--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"qty_pairs" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "shipment_items_qty_positive" CHECK (qty_pairs > 0)
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_number" text NOT NULL,
	"ship_date" date NOT NULL,
	"customer" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sole_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"mixture_id" uuid NOT NULL,
	"mixture_kg_per_pair" numeric(12, 3) NOT NULL,
	"target_cycle_seconds" integer,
	"sale_price_cents" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sole_models_kg_per_pair_positive" CHECK (mixture_kg_per_pair > 0),
	CONSTRAINT "sole_models_cycle_positive" CHECK (target_cycle_seconds IS NULL OR target_cycle_seconds > 0),
	CONSTRAINT "sole_models_price_positive" CHECK (sale_price_cents IS NULL OR sale_price_cents > 0)
);
--> statement-breakpoint
CREATE TABLE "work_order_labor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"hourly_rate_cents" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "work_order_labor_hours_positive" CHECK (hours > 0),
	CONSTRAINT "work_order_labor_rate_positive" CHECK (hourly_rate_cents > 0)
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"sole_model_id" uuid NOT NULL,
	"qty_pairs_planned" integer NOT NULL,
	"status" text DEFAULT 'nova' NOT NULL,
	"prep_branch" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "work_orders_qty_positive" CHECK (qty_pairs_planned > 0),
	CONSTRAINT "work_orders_status_allowed" CHECK (status IN ('nova', 'vo_vyrobe', 'dokoncena', 'zrusena')),
	CONSTRAINT "work_orders_prep_branch_allowed" CHECK (prep_branch IS NULL OR prep_branch IN ('barwell', 'sekanie'))
);
--> statement-breakpoint
ALTER TABLE "defect_reasons" ADD CONSTRAINT "defect_reasons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_run_defects" ADD CONSTRAINT "press_run_defects_press_run_id_press_runs_id_fk" FOREIGN KEY ("press_run_id") REFERENCES "public"."press_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_run_defects" ADD CONSTRAINT "press_run_defects_defect_reason_id_defect_reasons_id_fk" FOREIGN KEY ("defect_reason_id") REFERENCES "public"."defect_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_run_defects" ADD CONSTRAINT "press_run_defects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_run_downtimes" ADD CONSTRAINT "press_run_downtimes_press_run_id_press_runs_id_fk" FOREIGN KEY ("press_run_id") REFERENCES "public"."press_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_run_downtimes" ADD CONSTRAINT "press_run_downtimes_reason_id_downtime_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."downtime_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_run_downtimes" ADD CONSTRAINT "press_run_downtimes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_runs" ADD CONSTRAINT "press_runs_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_runs" ADD CONSTRAINT "press_runs_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_runs" ADD CONSTRAINT "press_runs_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_runs" ADD CONSTRAINT "press_runs_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_runs" ADD CONSTRAINT "press_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_records" ADD CONSTRAINT "scrap_records_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_records" ADD CONSTRAINT "scrap_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sole_models" ADD CONSTRAINT "sole_models_mixture_id_mixtures_id_fk" FOREIGN KEY ("mixture_id") REFERENCES "public"."mixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sole_models" ADD CONSTRAINT "sole_models_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_labor" ADD CONSTRAINT "work_order_labor_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_labor" ADD CONSTRAINT "work_order_labor_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_labor" ADD CONSTRAINT "work_order_labor_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_sole_model_id_sole_models_id_fk" FOREIGN KEY ("sole_model_id") REFERENCES "public"."sole_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "defect_reasons_code_uq" ON "defect_reasons" USING btree ("code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "press_run_defects_run_reason_uq" ON "press_run_defects" USING btree ("press_run_id","defect_reason_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "press_run_downtimes_run_idx" ON "press_run_downtimes" USING btree ("press_run_id");--> statement-breakpoint
CREATE INDEX "press_runs_order_idx" ON "press_runs" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "press_runs_batch_idx" ON "press_runs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "scrap_records_order_idx" ON "scrap_records" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_items_shipment_order_uq" ON "shipment_items" USING btree ("shipment_id","work_order_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "shipment_items_order_idx" ON "shipment_items" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_number_uq" ON "shipments" USING btree ("shipment_number") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sole_models_code_uq" ON "sole_models" USING btree ("code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "work_order_labor_order_idx" ON "work_order_labor" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_number_uq" ON "work_orders" USING btree ("order_number") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "work_orders_status_idx" ON "work_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_orders_sole_model_idx" ON "work_orders" USING btree ("sole_model_id");