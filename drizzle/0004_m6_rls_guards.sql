-- M6 Lisovňa: RLS + DB guardy (vzor 0001).
--
-- (1) RLS deny-all na všetkých nových tabuľkách (mutácie len cez server
--     actions so service role).
-- (2) Tvrdá väzba výkonov na SCHVÁLENÉ dávky (SPEC §12 — over aj cez API),
--     zhoda zmesi s artiklom, rozpočet Σ mixture_kg ≤ output_kg, immutabilita
--     väzieb, re-check expedície pri úprave výkonu. Sum-checky serializuje
--     row-lock rodičov (poradie zámkov vždy dávka → príkaz).
-- (3) Stavový automat výrobného príkazu + ochrana detí dokončeného príkazu.
-- (4) Sklad hotových výrobkov nejde do mínusu (Σ expedované ≤ Σ vyrobené).
-- (5) Zákaz hard DELETE na knihách výkonov a položiek DL (oprava = soft delete).
-- (6) output_kg schválenej dávky je nemenné (rozpočet spotreby lisovne).

ALTER TABLE "defect_reasons" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sole_models" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "work_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "work_order_labor" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "press_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "press_run_defects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "press_run_downtimes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "scrap_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shipment_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ───────────────────────── výkony: tvrdá väzba na schválenú zmes ──

CREATE FUNCTION enforce_press_run() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  davka RECORD;
  prikaz RECORD;
  zmes_artikla uuid;
  zmes_davky uuid;
  spotreba numeric;
  vyrobene integer;
  expedovane integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.work_order_id IS DISTINCT FROM OLD.work_order_id THEN
      RAISE EXCEPTION 'Väzba výkonu na výrobný príkaz je nemenná — oprava = storno a nový záznam.';
    END IF;
    IF NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
      RAISE EXCEPTION 'Väzba výkonu na dávku zmesi je nemenná — oprava = storno a nový záznam.';
    END IF;
  END IF;

  -- Row-locky proti súbehu sum-checkov; poradie zámkov: dávka → príkaz.
  SELECT id, batch_number, status, output_kg, deleted_at INTO davka
    FROM production_batches WHERE id = NEW.batch_id FOR UPDATE;
  SELECT id, status INTO prikaz
    FROM work_orders WHERE id = NEW.work_order_id FOR UPDATE;

  IF davka.id IS NULL THEN
    RAISE EXCEPTION 'Dávka zmesi neexistuje.';
  END IF;
  IF davka.deleted_at IS NOT NULL OR davka.status <> 'schvalena' THEN
    RAISE EXCEPTION 'Dávka % nie je schválená labákom — výdaj zmesi do lisovne je zakázaný.', davka.batch_number;
  END IF;
  IF davka.output_kg IS NULL THEN
    RAISE EXCEPTION 'Dávka % nemá vyplnené vyrobené kg — spotrebu nemožno strážiť.', davka.batch_number;
  END IF;

  IF prikaz.id IS NULL THEN
    RAISE EXCEPTION 'Výrobný príkaz neexistuje.';
  END IF;
  IF prikaz.status IN ('dokoncena', 'zrusena') THEN
    RAISE EXCEPTION 'Príkaz je v stave „%" — výkony nemožno meniť.', prikaz.status;
  END IF;

  -- Zhoda zmesi: dávka (cez recept) musí byť zo zmesi artiklu príkazu.
  SELECT sm.mixture_id INTO zmes_artikla
    FROM work_orders wo
    JOIN sole_models sm ON sm.id = wo.sole_model_id
   WHERE wo.id = NEW.work_order_id;
  SELECT r.mixture_id INTO zmes_davky
    FROM production_batches pb
    JOIN recipes r ON r.id = pb.recipe_id
   WHERE pb.id = NEW.batch_id;
  IF zmes_davky IS DISTINCT FROM zmes_artikla THEN
    RAISE EXCEPTION 'Dávka % je z inej zmesi, než vyžaduje artikel príkazu.', davka.batch_number;
  END IF;

  -- Rozpočet dávky: Σ živej spotreby lisovne ≤ vyrobené kg dávky.
  SELECT COALESCE(SUM(mixture_kg), 0) INTO spotreba
    FROM press_runs
   WHERE batch_id = NEW.batch_id AND id <> NEW.id AND deleted_at IS NULL;
  IF NEW.deleted_at IS NULL THEN
    spotreba := spotreba + NEW.mixture_kg;
  END IF;
  IF spotreba > davka.output_kg THEN
    RAISE EXCEPTION 'Prekročený zostatok dávky % — spotreba % kg presahuje vyrobených % kg.', davka.batch_number, spotreba, davka.output_kg;
  END IF;

  -- Úprava/storno výkonu nesmie znížiť vyrobené páry pod už expedované.
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(SUM(pairs_produced), 0) INTO vyrobene
      FROM press_runs
     WHERE work_order_id = NEW.work_order_id AND id <> NEW.id AND deleted_at IS NULL;
    IF NEW.deleted_at IS NULL THEN
      vyrobene := vyrobene + NEW.pairs_produced;
    END IF;
    SELECT COALESCE(SUM(qty_pairs), 0) INTO expedovane
      FROM shipment_items
     WHERE work_order_id = NEW.work_order_id AND deleted_at IS NULL;
    IF expedovane > vyrobene THEN
      RAISE EXCEPTION 'Úprava výkonu by znížila vyrobené páry (%) pod už expedované množstvo (%).', vyrobene, expedovane;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER press_runs_guard
BEFORE INSERT OR UPDATE ON press_runs
FOR EACH ROW EXECUTE FUNCTION enforce_press_run();
--> statement-breakpoint

-- ───────────────── zákaz hard DELETE (oprava = soft delete) ──

CREATE FUNCTION lisovna_forbid_hard_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Záznamy tabuľky % nemožno mazať — oprava = soft delete (deleted_at).', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER press_runs_forbid_delete
BEFORE DELETE ON press_runs
FOR EACH ROW EXECUTE FUNCTION lisovna_forbid_hard_delete();
--> statement-breakpoint
CREATE TRIGGER shipment_items_forbid_delete
BEFORE DELETE ON shipment_items
FOR EACH ROW EXECUTE FUNCTION lisovna_forbid_hard_delete();
--> statement-breakpoint

-- ───────────── výrobný príkaz: stavový automat + soft delete guard ──

CREATE FUNCTION enforce_work_order_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'nova' THEN
      RAISE EXCEPTION 'Nový výrobný príkaz musí vzniknúť v stave „nova".';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'nova'      AND NEW.status IN ('vo_vyrobe', 'zrusena'))
      OR (OLD.status = 'vo_vyrobe' AND NEW.status = 'dokoncena')
      OR (OLD.status = 'dokoncena' AND NEW.status = 'vo_vyrobe')
    ) THEN
      RAISE EXCEPTION 'Neplatný prechod stavu príkazu: % → %', OLD.status, NEW.status;
    END IF;
  END IF;

  IF NEW.sole_model_id IS DISTINCT FROM OLD.sole_model_id THEN
    IF EXISTS (SELECT 1 FROM press_runs WHERE work_order_id = NEW.id AND deleted_at IS NULL)
       OR EXISTS (SELECT 1 FROM shipment_items WHERE work_order_id = NEW.id AND deleted_at IS NULL)
    THEN
      RAISE EXCEPTION 'Artikel príkazu nemožno zmeniť — existujú výkony alebo expedícia. Založ nový príkaz.';
    END IF;
  END IF;

  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM press_runs WHERE work_order_id = NEW.id AND deleted_at IS NULL)
       OR EXISTS (SELECT 1 FROM shipment_items WHERE work_order_id = NEW.id AND deleted_at IS NULL)
       OR EXISTS (SELECT 1 FROM scrap_records WHERE work_order_id = NEW.id AND deleted_at IS NULL)
       OR EXISTS (SELECT 1 FROM work_order_labor WHERE work_order_id = NEW.id AND deleted_at IS NULL)
    THEN
      RAISE EXCEPTION 'Príkaz so živými záznamami (výkony/orez/práca/expedícia) nemožno zmazať.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_orders_guard
BEFORE INSERT OR UPDATE ON work_orders
FOR EACH ROW EXECUTE FUNCTION enforce_work_order_guard();
--> statement-breakpoint

-- ───────── položky DL: sklad hotových výrobkov nejde do mínusu ──

CREATE FUNCTION enforce_shipment_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prikaz RECORD;
  vyrobene integer;
  expedovane integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
       OR NEW.shipment_id IS DISTINCT FROM OLD.shipment_id THEN
      RAISE EXCEPTION 'Väzby položky dodacieho listu sú nemenné — oprava = storno a nová položka.';
    END IF;
  END IF;

  -- Row-lock príkazu — jediný serializačný bod invariantu expedované ≤ vyrobené.
  SELECT id, status INTO prikaz
    FROM work_orders WHERE id = NEW.work_order_id FOR UPDATE;

  IF prikaz.id IS NULL THEN
    RAISE EXCEPTION 'Výrobný príkaz neexistuje.';
  END IF;
  IF prikaz.status IN ('nova', 'zrusena') THEN
    RAISE EXCEPTION 'Z príkazu v stave „%" nemožno expedovať.', prikaz.status;
  END IF;

  SELECT COALESCE(SUM(pairs_produced), 0) INTO vyrobene
    FROM press_runs
   WHERE work_order_id = NEW.work_order_id AND deleted_at IS NULL;
  SELECT COALESCE(SUM(qty_pairs), 0) INTO expedovane
    FROM shipment_items
   WHERE work_order_id = NEW.work_order_id AND id <> NEW.id AND deleted_at IS NULL;
  IF NEW.deleted_at IS NULL THEN
    expedovane := expedovane + NEW.qty_pairs;
  END IF;
  IF expedovane > vyrobene THEN
    RAISE EXCEPTION 'Nedostatok hotových párov: príkaz má vyrobených % párov, expedovalo by sa % párov.', vyrobene, expedovane;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shipment_items_guard
BEFORE INSERT OR UPDATE ON shipment_items
FOR EACH ROW EXECUTE FUNCTION enforce_shipment_item();
--> statement-breakpoint

-- ─────────── deti príkazu (orez, práca): len na živom príkaze ──

CREATE FUNCTION enforce_order_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prikaz RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.work_order_id IS DISTINCT FROM OLD.work_order_id THEN
    RAISE EXCEPTION 'Väzba záznamu na výrobný príkaz je nemenná.';
  END IF;

  SELECT id, status INTO prikaz
    FROM work_orders WHERE id = NEW.work_order_id FOR UPDATE;
  IF prikaz.id IS NULL THEN
    RAISE EXCEPTION 'Výrobný príkaz neexistuje.';
  END IF;
  IF prikaz.status IN ('dokoncena', 'zrusena') THEN
    RAISE EXCEPTION 'Príkaz je v stave „%" — záznamy nemožno meniť.', prikaz.status;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER scrap_records_guard
BEFORE INSERT OR UPDATE ON scrap_records
FOR EACH ROW EXECUTE FUNCTION enforce_order_child();
--> statement-breakpoint
CREATE TRIGGER work_order_labor_guard
BEFORE INSERT OR UPDATE ON work_order_labor
FOR EACH ROW EXECUTE FUNCTION enforce_order_child();
--> statement-breakpoint

-- ─────── deti výkonu (nepodarky, prestoje): len na živom príkaze ──

CREATE FUNCTION enforce_run_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  stav_prikazu text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.press_run_id IS DISTINCT FROM OLD.press_run_id THEN
    RAISE EXCEPTION 'Väzba záznamu na výkon je nemenná.';
  END IF;

  SELECT wo.status INTO stav_prikazu
    FROM press_runs pr
    JOIN work_orders wo ON wo.id = pr.work_order_id
   WHERE pr.id = NEW.press_run_id
   FOR UPDATE OF wo;
  IF stav_prikazu IS NULL THEN
    RAISE EXCEPTION 'Výkon neexistuje.';
  END IF;
  IF stav_prikazu IN ('dokoncena', 'zrusena') THEN
    RAISE EXCEPTION 'Príkaz je v stave „%" — záznamy výkonu nemožno meniť.', stav_prikazu;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER press_run_defects_guard
BEFORE INSERT OR UPDATE ON press_run_defects
FOR EACH ROW EXECUTE FUNCTION enforce_run_child();
--> statement-breakpoint
CREATE TRIGGER press_run_downtimes_guard
BEFORE INSERT OR UPDATE ON press_run_downtimes
FOR EACH ROW EXECUTE FUNCTION enforce_run_child();
--> statement-breakpoint

-- ─────── schválená dávka: output_kg je rozpočet lisovne, nemenné ──

CREATE FUNCTION forbid_approved_output_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.output_kg IS DISTINCT FROM OLD.output_kg AND OLD.status = 'schvalena' THEN
    RAISE EXCEPTION 'Schválenej dávke nemožno meniť vyrobené kg — je rozpočtom spotreby lisovne.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER production_batches_output_guard
BEFORE UPDATE ON production_batches
FOR EACH ROW EXECUTE FUNCTION forbid_approved_output_change();
--> statement-breakpoint

-- ─────────── artikel: zmes nemenná pri existujúcich príkazoch ──

CREATE FUNCTION enforce_sole_model_mixture() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mixture_id IS DISTINCT FROM OLD.mixture_id THEN
    IF EXISTS (SELECT 1 FROM work_orders WHERE sole_model_id = NEW.id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Zmes artiklu nemožno zmeniť — existujú výrobné príkazy. Založ nový artikel.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sole_models_mixture_guard
BEFORE UPDATE ON sole_models
FOR EACH ROW EXECUTE FUNCTION enforce_sole_model_mixture();
