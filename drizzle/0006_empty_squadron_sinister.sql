CREATE TABLE "calc_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'default' NOT NULL,
	"energy_valcovna_pct" integer NOT NULL,
	"energy_lisovna_pct" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "calc_settings_pct_range" CHECK (energy_valcovna_pct BETWEEN 0 AND 100 AND energy_lisovna_pct BETWEEN 0 AND 100),
	CONSTRAINT "calc_settings_pct_sum" CHECK (energy_valcovna_pct + energy_lisovna_pct = 100)
);
--> statement-breakpoint
CREATE TABLE "cost_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"period_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "cost_corrections_amount_nonzero" CHECK (amount_cents <> 0),
	CONSTRAINT "cost_corrections_first_of_month" CHECK (period_date = date_trunc('month', period_date)::date)
);
--> statement-breakpoint
CREATE TABLE "overhead_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_close_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"pool_cents" integer NOT NULL,
	"basis" numeric(16, 3) NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "overhead_allocations_basis_nonnegative" CHECK (basis >= 0)
);
--> statement-breakpoint
CREATE TABLE "period_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "period_closes_first_of_month" CHECK (period = date_trunc('month', period)::date)
);
--> statement-breakpoint
ALTER TABLE "calc_settings" ADD CONSTRAINT "calc_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_corrections" ADD CONSTRAINT "cost_corrections_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_corrections" ADD CONSTRAINT "cost_corrections_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_corrections" ADD CONSTRAINT "cost_corrections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_allocations" ADD CONSTRAINT "overhead_allocations_period_close_id_period_closes_id_fk" FOREIGN KEY ("period_close_id") REFERENCES "public"."period_closes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_allocations" ADD CONSTRAINT "overhead_allocations_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_allocations" ADD CONSTRAINT "overhead_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closes" ADD CONSTRAINT "period_closes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calc_settings_code_uq" ON "calc_settings" USING btree ("code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "cost_corrections_period_idx" ON "cost_corrections" USING btree ("period_date");--> statement-breakpoint
CREATE UNIQUE INDEX "overhead_allocations_close_center_uq" ON "overhead_allocations" USING btree ("period_close_id","cost_center_id");--> statement-breakpoint
CREATE UNIQUE INDEX "period_closes_period_uq" ON "period_closes" USING btree ("period") WHERE deleted_at IS NULL;