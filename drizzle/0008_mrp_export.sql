-- F3: evidencia exportu došlých faktúr do MRP (XML 2.0).
-- Aditívne: NULL = zatiaľ neexportovaná. Period-lock trigger (0007) pole
-- neblokuje — značenie exportu má prejsť aj v uzavretom mesiaci.
ALTER TABLE "invoices" ADD COLUMN "mrp_exported_at" timestamp with time zone;