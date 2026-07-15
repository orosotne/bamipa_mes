-- 0001 — RLS, DB triggre, guardy a kalkulačné view (F1)
-- Dôvody: SPEC §8 (row-level ochrana), SPEC §12 („over aj cez API"),
-- D1 (výdaj pod nulu zakázaný), akceptačné kritérium ručnej prepočítateľnosti.

-- ============================================================
-- 1) ROW LEVEL SECURITY na všetkých tabuľkách.
--    Žiadne policy pre anon/authenticated => deny-all cez PostgREST.
--    Všetky mutácie idú výhradne cez server actions (service role,
--    ktorá RLS obchádza). Čítanie pre klientov sa (ak vôbec) otvorí
--    neskôr explicitnými SELECT policy per rola.
-- ============================================================
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "machines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "labor_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "downtime_reasons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "materials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "material_suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "material_lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mixtures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipe_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "production_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lab_parameters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lab_test_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lab_tests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lab_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "batch_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "batch_labor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "batch_downtimes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_moves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- ============================================================
-- 2) stock_moves: append-only kniha + údržba zostatku šarže.
--    qty_remaining udržiava VÝHRADNE apply_stock_move (jediný write path,
--    transakčne lokálny flag); relatívny UPDATE + CHECK (qty_remaining >= 0)
--    blokuje prečerpanie aj pri súbehu dvoch tabletov (row lock).
--    Invariant: qty_remaining = Σ qty_delta všetkých pohybov šarže.
-- ============================================================
CREATE FUNCTION apply_stock_move() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lot_found boolean;
BEGIN
  PERFORM set_config('bamipa.applying_stock_move', '1', true);
  UPDATE material_lots
     SET qty_remaining = qty_remaining + NEW.qty_delta
   WHERE id = NEW.lot_id;
  -- POZOR: PERFORM prepíše FOUND — výsledok UPDATE treba zachytiť hneď.
  lot_found := FOUND;
  PERFORM set_config('bamipa.applying_stock_move', '0', true);
  IF NOT lot_found THEN
    RAISE EXCEPTION 'Šarža % neexistuje.', NEW.lot_id;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER stock_moves_apply
AFTER INSERT ON stock_moves
FOR EACH ROW EXECUTE FUNCTION apply_stock_move();--> statement-breakpoint

-- Jediná povolená mutácia existujúceho pohybu: cenová korekcia dokladu
-- (prepis unit_price snapshotov podľa schválenej politiky — jedna transakcia
-- s prepisom lot ceny + audit_log diff). Množstvá, väzby a typ sú nemenné;
-- oprava množstva sa robí protipohybom (korekcia s reversed_move_id).
CREATE FUNCTION forbid_stock_move_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.id = OLD.id
     AND NEW.lot_id = OLD.lot_id
     AND NEW.move_type = OLD.move_type
     AND NEW.qty_delta = OLD.qty_delta
     AND NEW.batch_id IS NOT DISTINCT FROM OLD.batch_id
     AND NEW.adjustment_id IS NOT DISTINCT FROM OLD.adjustment_id
     AND NEW.reversed_move_id IS NOT DISTINCT FROM OLD.reversed_move_id
     AND NEW.cost_center_id IS NOT DISTINCT FROM OLD.cost_center_id
     AND NEW.note IS NOT DISTINCT FROM OLD.note
     AND NEW.created_at = OLD.created_at
     AND NEW.created_by = OLD.created_by
  THEN
    RETURN NEW; -- zmenil sa len unit_price → cenová korekcia povolená
  END IF;
  RAISE EXCEPTION
    'Kniha pohybov je append-only — oprava množstva sa robí protipohybom (korekcia s reversed_move_id); meniť možno len unit_price (cenová korekcia dokladu).';
END;
$$;--> statement-breakpoint

CREATE TRIGGER stock_moves_append_only
BEFORE UPDATE OR DELETE ON stock_moves
FOR EACH ROW EXECUTE FUNCTION forbid_stock_move_mutation();--> statement-breakpoint

-- ============================================================
-- 3) material_lots: zostatok mení výhradne kniha pohybov.
--    Lot vzniká vždy so zostatkom 0 — na stav ho dostane 'prijem' pohyb
--    (inak by sa qty_received započítalo dvojmo).
-- ============================================================
CREATE FUNCTION guard_material_lot_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.qty_remaining <> 0 THEN
      RAISE EXCEPTION
        'Šarža vzniká so zostatkom 0 — na stav ju dostane „prijem" pohyb v knihe (stock_moves).';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.qty_remaining IS DISTINCT FROM OLD.qty_remaining
     AND current_setting('bamipa.applying_stock_move', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION
      'qty_remaining mení výhradne kniha pohybov (stock_moves) — použi prijem/vydaj/korekciu.';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER material_lots_mutation_guard
BEFORE INSERT OR UPDATE ON material_lots
FOR EACH ROW EXECUTE FUNCTION guard_material_lot_mutation();--> statement-breakpoint

-- ============================================================
-- 4) QC brána: stavový automat dávky vynútený v DB.
--    Nová dávka vzniká výhradne ako 'rozpracovana' (INSERT guard).
--    rozpracovana → caka_na_labak → schvalena | zamietnuta;
--    zamietnuta → caka_na_labak (rework). Prechod do caka_na_labak
--    vyžaduje output_kg (po reworku znovu potvrdené). O schválení/
--    zamietnutí rozhoduje verdikt POSLEDNÉHO živého testu dávky.
--    (SPEC §12: „Nie je možné vydať do lisovne zmes bez verdiktu
--    SCHVÁLENÉ — over aj cez API.")
-- ============================================================
CREATE FUNCTION enforce_batch_initial_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'rozpracovana' THEN
    RAISE EXCEPTION 'Nová dávka musí vzniknúť v stave „rozpracovaná" (dostala: %).', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER production_batches_insert_guard
BEFORE INSERT ON production_batches
FOR EACH ROW EXECUTE FUNCTION enforce_batch_initial_status();--> statement-breakpoint

CREATE FUNCTION enforce_batch_status_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest_verdict lab_verdict;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'rozpracovana'  AND NEW.status = 'caka_na_labak')
      OR (OLD.status = 'caka_na_labak' AND NEW.status IN ('schvalena', 'zamietnuta'))
      OR (OLD.status = 'zamietnuta'    AND NEW.status = 'caka_na_labak')
    ) THEN
      RAISE EXCEPTION 'Neplatný prechod stavu dávky: % → %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'caka_na_labak' AND NEW.output_kg IS NULL THEN
      RAISE EXCEPTION 'Prechod do „čaká na labák" vyžaduje vyplnené output_kg.';
    END IF;

    IF NEW.status IN ('schvalena', 'zamietnuta') THEN
      SELECT verdict INTO latest_verdict
        FROM lab_tests
       WHERE batch_id = NEW.id AND deleted_at IS NULL
       ORDER BY sequence_no DESC
       LIMIT 1;

      IF NEW.status = 'schvalena' AND latest_verdict IS DISTINCT FROM 'schvalene' THEN
        RAISE EXCEPTION
          'Dávku nemožno schváliť — posledný test labáku nemá verdikt SCHVÁLENÉ.';
      END IF;
      IF NEW.status = 'zamietnuta' AND latest_verdict IS DISTINCT FROM 'zamietnute' THEN
        RAISE EXCEPTION
          'Dávku nemožno zamietnuť — posledný test labáku nemá verdikt ZAMIETNUTÉ.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER production_batches_status_guard
BEFORE UPDATE ON production_batches
FOR EACH ROW EXECUTE FUNCTION enforce_batch_status_transition();--> statement-breakpoint

-- ============================================================
-- 5) Nemennosť verzií receptov: recipe_items verzie, na ktorú existuje
--    dávka, sa nesmú meniť ani mazať ("oprava preklepu" = nová verzia).
--    Na UPDATE sa kontroluje OLD aj NEW recipe_id (presun položky DO
--    použitého receptu je tiež mutácia jeho BOM). Derivovaný plán navážky
--    (recipe_items × scale_factor) je korektný len vďaka tomuto pravidlu.
-- ============================================================
CREATE FUNCTION forbid_used_recipe_item_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM production_batches WHERE recipe_id = OLD.recipe_id)
     OR (TG_OP = 'UPDATE' AND EXISTS (
           SELECT 1 FROM production_batches WHERE recipe_id = NEW.recipe_id))
  THEN
    RAISE EXCEPTION
      'Verzia receptu už má výrobné dávky — položky sú nemenné. Vytvor novú verziu.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER recipe_items_immutability_guard
BEFORE UPDATE OR DELETE ON recipe_items
FOR EACH ROW EXECUTE FUNCTION forbid_used_recipe_item_mutation();--> statement-breakpoint

-- ============================================================
-- 6) v_batch_costs — základný náklad dávky / na kg (F1: priame náklady).
--    Materiál = VŠETKY pohyby s batch_id (vydaj aj korekcie/storná —
--    kladné delta náklad znižuje). Inventúrne korekcie (batch_id NULL)
--    nevstupujú; 'prijem' nikdy nemá batch_id (CHECK). Zaokrúhlenie:
--    raz na konci agregátu (round half up), materiál a práca zvlášť —
--    ručne prepočítateľné na dokladoch. Do váženého priemeru za obdobie
--    vstupujú len dávky 'schvalena' (agregácia v reportoch podľa
--    production_date).
-- ============================================================
CREATE VIEW v_batch_costs AS
SELECT
  b.id            AS batch_id,
  b.batch_number,
  b.status,
  b.production_date,
  b.recipe_id,
  b.output_kg,
  round(COALESCE(m.material_raw, 0))::bigint        AS material_cents,
  round(COALESCE(l.labor_raw, 0))::bigint           AS labor_cents,
  round(COALESCE(m.rework_material_raw, 0))::bigint AS rework_material_cents,
  round(COALESCE(l.rework_labor_raw, 0))::bigint    AS rework_labor_cents,
  (round(COALESCE(m.material_raw, 0)) + round(COALESCE(l.labor_raw, 0)))::bigint
                                                    AS total_cents,
  CASE
    WHEN b.output_kg IS NOT NULL AND b.output_kg > 0 THEN
      round(
        (round(COALESCE(m.material_raw, 0)) + round(COALESCE(l.labor_raw, 0)))
        / b.output_kg, 2)
  END                                               AS cost_per_kg_cents
FROM production_batches b
LEFT JOIN LATERAL (
  SELECT
    sum(-sm.qty_delta * sm.unit_price) AS material_raw,
    sum(-sm.qty_delta * sm.unit_price)
      FILTER (WHERE sm.adjustment_id IS NOT NULL) AS rework_material_raw
  FROM stock_moves sm
  WHERE sm.batch_id = b.id
) m ON true
LEFT JOIN LATERAL (
  SELECT
    sum(bl.hours * bl.hourly_rate_cents) AS labor_raw,
    sum(bl.hours * bl.hourly_rate_cents)
      FILTER (WHERE bl.adjustment_id IS NOT NULL) AS rework_labor_raw
  FROM batch_labor bl
  WHERE bl.batch_id = b.id
    AND bl.deleted_at IS NULL
) l ON true;
