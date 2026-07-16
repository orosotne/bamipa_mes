-- 0007 — M7 kalkulácie: RLS, zámok uzavretého obdobia, kalkulačné views.
-- Dôvody: SPEC §8 (row-level ochrana), SPEC M7 (uzávierka — po uzamknutí sa
-- doklady obdobia nemenia), D2/D4 alokácie, akceptačné kritérium ručnej
-- prepočítateľnosti (§12) a idempotencie uzávierky.

-- ============================================================
-- 1) RLS na nových tabuľkách — deny-all pre PostgREST, mutácie
--    výhradne server actions (service role), ako 0001.
-- ============================================================
ALTER TABLE "period_closes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "overhead_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calc_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cost_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- ============================================================
-- 2) assert_period_open — jediný zdroj pravdy zámku obdobia.
--    Mesiac dokladu je zamknutý ⇔ NIE JE nad hranicou uzávierok
--    (max period živých uzávierok). Zamyká to aj nikdy neuzavreté
--    „medzerové" mesiace pod hranicou — oneskorený doklad by rozbil
--    carry-forward reťaz a dodatočné uzávierky mimo poradia
--    (nález adversariálnej review). Oneskorené doklady patria do
--    aktuálneho otvoreného mesiaca. Triggre dokladov nasledujú nižšie.
-- ============================================================
CREATE FUNCTION assert_period_open(doklad_datum date, kontext text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  hranica date;
BEGIN
  -- GLOBÁLNY zdieľaný advisory zámok — páruje sa s exkluzívnym v
  -- uzavriMesiac/otvorMesiac (close.ts): doklad nevkĺzne do mesiaca počas
  -- prebiehajúcej uzávierky/reopenu a uzávierka počká na rozbehnuté
  -- dokladové transakcie. Kľúč (74201, 0) je spoločný pre všetky mesiace —
  -- serializuje aj close(M+1) vs reopen(M) (nález review).
  PERFORM pg_advisory_xact_lock_shared(74201, 0);
  SELECT max(period) INTO hranica FROM period_closes WHERE deleted_at IS NULL;
  IF hranica IS NOT NULL
     AND date_trunc('month', doklad_datum)::date <= hranica THEN
    RAISE EXCEPTION
      'Mesiac %.% je uzavretý alebo pod hranicou poslednej uzávierky (%.%) — % nemožno meniť. Opravy patria do aktuálneho obdobia (korekčná položka), reopen smie len admin.',
      extract(month FROM doklad_datum)::int,
      extract(year FROM doklad_datum)::int,
      extract(month FROM hranica)::int,
      extract(year FROM hranica)::int,
      kontext;
  END IF;
END;
$$;--> statement-breakpoint

-- ============================================================
-- 3) Zámky nákladových dokladov uzavretého mesiaca (SPEC M7:
--    „po uzávierke sa doklady obdobia nemenia", §12 „over aj cez
--    API"). Nákladovo neutrálne operácie ostávajú voľné: QC verdikt
--    a poznámka dávky, status/prílohy/platby faktúr, prestoje (KPI
--    bez €). Vedomý dôsledok: rework zamietnutej dávky po uzávierke
--    jej mesiaca je blokovaný — oprava = nová dávka v novom mesiaci.
-- ============================================================

-- Pohyb knihy patriaci dávke = doklad mesiaca dávky. UPDATE rieši jedinú
-- povolenú mutáciu (cenová korekcia unit_price, viď 0001) — pre uzavretý
-- mesiac je zakázaná aj tá; rozdiel účtuje corrections.ts do cost_corrections.
CREATE FUNCTION lock_stock_move_period() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.batch_id IS NOT NULL THEN
      SELECT production_date INTO d FROM production_batches WHERE id = NEW.batch_id;
      PERFORM assert_period_open(d, 'pohyby dávky');
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
    IF OLD.batch_id IS NOT NULL THEN
      SELECT production_date INTO d FROM production_batches WHERE id = OLD.batch_id;
    ELSE
      -- Mesiac ne-dávkového pohybu v Europe/Bratislava (nie session TZ) —
      -- konzistentné s dnesnyDatum() a corrections.ts (nález review).
      d := (OLD.created_at AT TIME ZONE 'Europe/Bratislava')::date;
    END IF;
    PERFORM assert_period_open(d, 'cenu pohybu');
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER stock_moves_period_lock
BEFORE INSERT OR UPDATE ON stock_moves
FOR EACH ROW EXECUTE FUNCTION lock_stock_move_period();--> statement-breakpoint

-- Dávka: v uzavretom mesiaci smie meniť len nákladovo neutrálne polia
-- (status — QC verdikt, note; updated_at sa mení vždy). Zmena production_date
-- vyžaduje otvorený zdrojový AJ cieľový mesiac.
CREATE FUNCTION lock_batch_period() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM assert_period_open(NEW.production_date, 'dávku');
    RETURN NEW;
  END IF;
  IF NEW.production_date IS DISTINCT FROM OLD.production_date THEN
    PERFORM assert_period_open(OLD.production_date, 'dátum dávky');
    PERFORM assert_period_open(NEW.production_date, 'dátum dávky');
    RETURN NEW;
  END IF;
  IF NEW.batch_number IS DISTINCT FROM OLD.batch_number
     OR NEW.recipe_id IS DISTINCT FROM OLD.recipe_id
     OR NEW.shift IS DISTINCT FROM OLD.shift
     OR NEW.machine_id IS DISTINCT FROM OLD.machine_id
     OR NEW.lead_worker_id IS DISTINCT FROM OLD.lead_worker_id
     OR NEW.scale_factor IS DISTINCT FROM OLD.scale_factor
     OR NEW.output_kg IS DISTINCT FROM OLD.output_kg
     OR NEW.work_minutes IS DISTINCT FROM OLD.work_minutes
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  THEN
    PERFORM assert_period_open(OLD.production_date, 'dávku');
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER production_batches_period_lock
BEFORE INSERT OR UPDATE ON production_batches
FOR EACH ROW EXECUTE FUNCTION lock_batch_period();--> statement-breakpoint

-- Práca dávky: náklad patrí dávke → rozhoduje mesiac DÁVKY (nie work_date).
CREATE FUNCTION lock_batch_labor_period() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d date;
BEGIN
  SELECT production_date INTO d FROM production_batches
   WHERE id = COALESCE(NEW.batch_id, OLD.batch_id);
  PERFORM assert_period_open(d, 'prácu dávky');
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE TRIGGER batch_labor_period_lock
BEFORE INSERT OR UPDATE OR DELETE ON batch_labor
FOR EACH ROW EXECUTE FUNCTION lock_batch_labor_period();--> statement-breakpoint

-- Výkon lisovne: doklad mesiaca run_date (vrátane storna = tombstone).
CREATE FUNCTION lock_press_run_period() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM assert_period_open(NEW.run_date, 'výkon lisovne');
    RETURN NEW;
  END IF;
  PERFORM assert_period_open(OLD.run_date, 'výkon lisovne');
  IF NEW.run_date IS DISTINCT FROM OLD.run_date THEN
    PERFORM assert_period_open(NEW.run_date, 'výkon lisovne');
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER press_runs_period_lock
BEFORE INSERT OR UPDATE ON press_runs
FOR EACH ROW EXECUTE FUNCTION lock_press_run_period();--> statement-breakpoint

-- Nepodarky výkonu: mesiac rodičovského výkonu.
CREATE FUNCTION lock_run_child_period() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d date;
BEGIN
  SELECT run_date INTO d FROM press_runs
   WHERE id = COALESCE(NEW.press_run_id, OLD.press_run_id);
  PERFORM assert_period_open(d, 'nepodarky výkonu');
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE TRIGGER press_run_defects_period_lock
BEFORE INSERT OR UPDATE OR DELETE ON press_run_defects
FOR EACH ROW EXECUTE FUNCTION lock_run_child_period();--> statement-breakpoint

-- Práca lisovne: doklad mesiaca work_date.
CREATE FUNCTION lock_work_order_labor_period() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_period_open(OLD.work_date, 'prácu lisovne');
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM assert_period_open(NEW.work_date, 'prácu lisovne');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE TRIGGER work_order_labor_period_lock
BEFORE INSERT OR UPDATE OR DELETE ON work_order_labor
FOR EACH ROW EXECUTE FUNCTION lock_work_order_labor_period();--> statement-breakpoint

-- Orez / pretoky: doklad mesiaca record_date (D5 vstupuje do KPI aj nákladu páru).
CREATE FUNCTION lock_scrap_period() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_period_open(OLD.record_date, 'orez príkazu');
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM assert_period_open(NEW.record_date, 'orez príkazu');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE TRIGGER scrap_records_period_lock
BEFORE INSERT OR UPDATE OR DELETE ON scrap_records
FOR EACH ROW EXECUTE FUNCTION lock_scrap_period();--> statement-breakpoint

-- Faktúra: nákladový mesiac = delivery ?? issue ?? due (ako uzávierka).
-- V uzavretom mesiaci smú zmeny len nákladovo neutrálne polia (status,
-- attachment_path, note, due_date — splatnosť je cash-flow). Platby
-- (invoice_payments) sa nezamykajú vôbec.
CREATE FUNCTION lock_invoice_period() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d_old date;
  d_new date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM assert_period_open(
      COALESCE(NEW.delivery_date, NEW.issue_date, NEW.due_date), 'faktúru');
    RETURN NEW;
  END IF;
  d_old := COALESCE(OLD.delivery_date, OLD.issue_date, OLD.due_date);
  d_new := COALESCE(NEW.delivery_date, NEW.issue_date, NEW.due_date);
  IF d_new IS DISTINCT FROM d_old
     OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.total_net_cents IS DISTINCT FROM OLD.total_net_cents
     OR NEW.total_vat_cents IS DISTINCT FROM OLD.total_vat_cents
     OR NEW.total_gross_cents IS DISTINCT FROM OLD.total_gross_cents
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  THEN
    PERFORM assert_period_open(d_old, 'faktúru');
    PERFORM assert_period_open(d_new, 'faktúru');
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER invoices_period_lock
BEFORE INSERT OR UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION lock_invoice_period();--> statement-breakpoint

-- Položka faktúry: mesiac rodičovskej faktúry.
CREATE FUNCTION lock_invoice_item_period() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d date;
BEGIN
  SELECT COALESCE(f.delivery_date, f.issue_date, f.due_date) INTO d
    FROM invoices f WHERE f.id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  PERFORM assert_period_open(d, 'položku faktúry');
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE TRIGGER invoice_items_period_lock
BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
FOR EACH ROW EXECUTE FUNCTION lock_invoice_item_period();--> statement-breakpoint

-- Korekčná položka: smie vznikať/meniť sa len v otvorenom mesiaci zaúčtovania.
CREATE FUNCTION lock_cost_correction_period() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_period_open(OLD.period_date, 'korekčnú položku');
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM assert_period_open(NEW.period_date, 'korekčnú položku');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE TRIGGER cost_corrections_period_lock
BEFORE INSERT OR UPDATE OR DELETE ON cost_corrections
FOR EACH ROW EXECUTE FUNCTION lock_cost_correction_period();--> statement-breakpoint

-- ============================================================
-- 4) v_batch_full_costs — plný náklad dávky (M7): priamy náklad
--    (v_batch_costs) + réžia valcovne (kg × sadzba c/kg mesiaca
--    dávky) + labák (% prirážka z priameho nákladu). Mesiac bez
--    živej uzávierky → réžie a plný náklad NULL (predbežné).
--    Alokácie sa zaokrúhľujú RAZ (round half up ako 0001);
--    ručný prepočet: kg × sadzba, priamy × % (SPEC §12).
-- ============================================================
CREATE VIEW v_batch_full_costs WITH (security_invoker = true) AS
SELECT
  bc.*,
  pc.id AS period_close_id,
  oa_v.rate AS valcovna_rate,
  oa_l.rate AS labak_pct,
  round(bc.output_kg * oa_v.rate)::bigint AS valcovna_overhead_cents,
  round(bc.total_cents * oa_l.rate / 100)::bigint AS labak_overhead_cents,
  (bc.total_cents
    + round(bc.output_kg * oa_v.rate)
    + round(bc.total_cents * oa_l.rate / 100))::bigint AS full_total_cents,
  CASE
    WHEN bc.output_kg IS NOT NULL AND bc.output_kg > 0 THEN
      round((bc.total_cents
        + round(bc.output_kg * oa_v.rate)
        + round(bc.total_cents * oa_l.rate / 100))::numeric(38,20) / bc.output_kg, 2)
  END AS full_cost_per_kg_cents
FROM v_batch_costs bc
LEFT JOIN period_closes pc
  ON pc.period = date_trunc('month', bc.production_date)::date
 AND pc.deleted_at IS NULL
LEFT JOIN cost_centers cc_v
  ON cc_v.code = 'valcovna' AND cc_v.deleted_at IS NULL
LEFT JOIN overhead_allocations oa_v
  ON oa_v.period_close_id = pc.id AND oa_v.cost_center_id = cc_v.id
LEFT JOIN cost_centers cc_l
  ON cc_l.code = 'labak' AND cc_l.deleted_at IS NULL
LEFT JOIN overhead_allocations oa_l
  ON oa_l.period_close_id = pc.id AND oa_l.cost_center_id = cc_l.id;--> statement-breakpoint

-- ============================================================
-- 5) v_work_order_costs — náklad príkazu a NA PÁR (SPEC M7, D5):
--    zmes = Σ kg výkonu × plný náklad dávky / output_kg dávky,
--    práca = Σ hodiny × snapshot sadzba, réžia lisovne = Σ cykly ×
--    sadzba mesiaca VÝKONU, správa = % prirážka na každú zložku
--    podľa JEJ mesiaca. Každá zložka zaokrúhlená RAZ; spolu = súčet
--    zložiek (obrazovka sedí so súčtom riadkov). Nepodarky a orez
--    nemajú zápočet (D5 100 % strata) — sú v čitateli, menovateľ
--    sú DOBRÉ páry. Zložka s neuzavretým mesiacom → NULL
--    (predbežná kalkulácia); počíta sa len zo ŽIVÝCH riadkov.
-- ============================================================
CREATE VIEW v_work_order_costs WITH (security_invoker = true) AS
SELECT
  x.*,
  (x.mixture_cents + x.labor_cents + x.press_overhead_cents + x.sprava_cents)::bigint
    AS total_cents,
  CASE
    WHEN x.pairs_produced > 0 THEN
      round((x.mixture_cents + x.labor_cents + x.press_overhead_cents
        + x.sprava_cents)::numeric(38,20) / x.pairs_produced, 2)
  END AS cost_per_pair_cents
FROM (
  SELECT
    wo.id AS work_order_id,
    wo.order_number,
    wo.status,
    wo.sole_model_id,
    COALESCE(r.cykly, 0)::int AS cycles_count,
    COALESCE(r.dobre_pary, 0)::int AS pairs_produced,
    COALESCE(d.nepodarky, 0)::int AS defect_pairs,
    COALESCE(r.zmes_kg, 0)::numeric(14,3) AS mixture_kg,
    COALESCE(s.orez_kg, 0)::numeric(14,3) AS scrap_kg,
    CASE
      WHEN COALESCE(r.pocet, 0) = 0 THEN 0::bigint
      WHEN r.chyba_zmes THEN NULL
      ELSE round(r.zmes_raw)::bigint
    END AS mixture_cents,
    round(COALESCE(l.praca_raw, 0))::bigint AS labor_cents,
    CASE
      WHEN COALESCE(r.pocet, 0) = 0 THEN 0::bigint
      WHEN r.chyba_rezia THEN NULL
      ELSE round(r.rezia_raw)::bigint
    END AS press_overhead_cents,
    CASE
      WHEN COALESCE(r.pocet, 0) = 0 AND COALESCE(l.pocet, 0) = 0 THEN 0::bigint
      WHEN COALESCE(r.chyba_sprava, false) OR COALESCE(l.chyba_sprava, false) THEN NULL
      ELSE round(COALESCE(r.sprava_raw, 0) + COALESCE(l.sprava_raw, 0))::bigint
    END AS sprava_cents
  FROM work_orders wo
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS pocet,
      sum(pr.cycles_count) AS cykly,
      sum(pr.pairs_produced) AS dobre_pary,
      sum(pr.mixture_kg) AS zmes_kg,
      bool_or(fb.full_total_cents IS NULL) AS chyba_zmes,
      -- ::numeric(38,20) drží chvost periodických podielov ďaleko od
      -- presných .5 hraníc pri finálnom round (nález review — SPEC §12).
      sum((pr.mixture_kg * fb.full_total_cents)::numeric(38,20)
        / fb.output_kg) AS zmes_raw,
      bool_or(oa.rate IS NULL) AS chyba_rezia,
      sum(pr.cycles_count * oa.rate) AS rezia_raw,
      bool_or(oa_s.rate IS NULL OR fb.full_total_cents IS NULL
        OR oa.rate IS NULL) AS chyba_sprava,
      sum(((pr.mixture_kg * fb.full_total_cents)::numeric(38,20) / fb.output_kg
        + pr.cycles_count * oa.rate) * oa_s.rate / 100) AS sprava_raw
    FROM press_runs pr
    JOIN v_batch_full_costs fb ON fb.batch_id = pr.batch_id
    LEFT JOIN period_closes pcr
      ON pcr.period = date_trunc('month', pr.run_date)::date
     AND pcr.deleted_at IS NULL
    LEFT JOIN cost_centers cl
      ON cl.code = 'lisovna' AND cl.deleted_at IS NULL
    LEFT JOIN overhead_allocations oa
      ON oa.period_close_id = pcr.id AND oa.cost_center_id = cl.id
    LEFT JOIN cost_centers cs
      ON cs.code = 'sprava' AND cs.deleted_at IS NULL
    LEFT JOIN overhead_allocations oa_s
      ON oa_s.period_close_id = pcr.id AND oa_s.cost_center_id = cs.id
    WHERE pr.work_order_id = wo.id AND pr.deleted_at IS NULL
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS pocet,
      sum(wol.hours * wol.hourly_rate_cents) AS praca_raw,
      bool_or(oa_s.rate IS NULL) AS chyba_sprava,
      sum(wol.hours * wol.hourly_rate_cents * oa_s.rate / 100) AS sprava_raw
    FROM work_order_labor wol
    LEFT JOIN period_closes pcl
      ON pcl.period = date_trunc('month', wol.work_date)::date
     AND pcl.deleted_at IS NULL
    LEFT JOIN cost_centers cs2
      ON cs2.code = 'sprava' AND cs2.deleted_at IS NULL
    LEFT JOIN overhead_allocations oa_s
      ON oa_s.period_close_id = pcl.id AND oa_s.cost_center_id = cs2.id
    WHERE wol.work_order_id = wo.id AND wol.deleted_at IS NULL
  ) l ON true
  LEFT JOIN LATERAL (
    SELECT sum(pd.qty_pairs) AS nepodarky
    FROM press_run_defects pd
    JOIN press_runs pr2 ON pr2.id = pd.press_run_id AND pr2.deleted_at IS NULL
    WHERE pr2.work_order_id = wo.id AND pd.deleted_at IS NULL
  ) d ON true
  LEFT JOIN LATERAL (
    SELECT sum(sr.qty_kg) AS orez_kg
    FROM scrap_records sr
    WHERE sr.work_order_id = wo.id AND sr.deleted_at IS NULL
  ) s ON true
  WHERE wo.deleted_at IS NULL
) x;--> statement-breakpoint

-- ============================================================
-- 6) Views nesmú obchádzať RLS (KRITICKÝ nález review): obyčajné
--    view beží s právami vlastníka a RLS podkladov sa neaplikuje —
--    cez PostgREST by si KTORÁKOĽVEK rola (aj anon s publishable
--    kľúčom) prečítala náklady, sadzby aj nákupné ceny. security_
--    invoker + REVOKE pre anon/authenticated (Supabase default
--    grant). Server actions idú cez service rolu — tej sa to netýka.
--    v_batch_costs je z 0001 — ALTER novou migráciou (0001 sa nemení).
-- ============================================================
ALTER VIEW v_batch_costs SET (security_invoker = true);--> statement-breakpoint

DO $$
BEGIN
  -- PGlite/test DB roly anon/authenticated nemá — REVOKE len ak existujú.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE v_batch_costs, v_batch_full_costs, v_work_order_costs
      FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE v_batch_costs, v_batch_full_costs, v_work_order_costs
      FROM authenticated;
  END IF;
END;
$$;--> statement-breakpoint
