-- M6 Lisovňa: spevnenie guardov (nálezy adversariálnej review).
--
-- (1) deleted_at rodičov: guardy z 0004 kontrolovali soft delete len na dávke.
--     ŽIVÉ zápisy (NEW.deleted_at IS NULL) sú teraz blokované aj na zmazanom
--     príkaze, stornovanom výkone a stornovanom DL. Tombstoning detí
--     (NEW.deleted_at IS NOT NULL) ostáva povolený — storno flowy mažú
--     rodiča pred deťmi (kanonické poradie zámkov dávka → príkaz).
-- (2) production_batches: dávku so živými výkonmi lisovne nemožno soft-deletnúť
--     (zrkadlo guardu work_orders; inak by sa storno výkonov zabetónovalo
--     na hláške „nie je schválená labákom").
--
-- Funkcie sa REDEFINUJÚ (CREATE OR REPLACE) — migrácie sa nikdy neprepisujú,
-- nové znenie ide novou migráciou.

CREATE OR REPLACE FUNCTION enforce_press_run() RETURNS trigger
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
  SELECT id, status, deleted_at INTO prikaz
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
  IF prikaz.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Výrobný príkaz je zmazaný — výkony naň nemožno zapisovať.';
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

CREATE OR REPLACE FUNCTION enforce_shipment_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prikaz RECORD;
  hlavicka_zmazana timestamptz;
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
  SELECT id, status, deleted_at INTO prikaz
    FROM work_orders WHERE id = NEW.work_order_id FOR UPDATE;

  -- Živý zápis na stornovaný DL by potichu odpočítal sklad hotových cez
  -- doklad neviditeľný v UI. Kontrola až PO zámku príkazu: storno DL drží
  -- zámky príkazov pred tombstonom hlavičky, takže čerstvý snapshot tu už
  -- vidí jeho commit (pred zámkom by čítanie mohlo byť stale).
  IF NEW.deleted_at IS NULL THEN
    SELECT deleted_at INTO hlavicka_zmazana
      FROM shipments WHERE id = NEW.shipment_id;
    IF hlavicka_zmazana IS NOT NULL THEN
      RAISE EXCEPTION 'Dodací list je stornovaný — položky naň nemožno pridávať.';
    END IF;
  END IF;

  IF prikaz.id IS NULL THEN
    RAISE EXCEPTION 'Výrobný príkaz neexistuje.';
  END IF;
  IF prikaz.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Výrobný príkaz je zmazaný — expedovať z neho nemožno.';
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

CREATE OR REPLACE FUNCTION enforce_order_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prikaz RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.work_order_id IS DISTINCT FROM OLD.work_order_id THEN
    RAISE EXCEPTION 'Väzba záznamu na výrobný príkaz je nemenná.';
  END IF;

  SELECT id, status, deleted_at INTO prikaz
    FROM work_orders WHERE id = NEW.work_order_id FOR UPDATE;
  IF prikaz.id IS NULL THEN
    RAISE EXCEPTION 'Výrobný príkaz neexistuje.';
  END IF;
  IF prikaz.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Výrobný príkaz je zmazaný — záznamy naň nemožno pridávať.';
  END IF;
  IF prikaz.status IN ('dokoncena', 'zrusena') THEN
    RAISE EXCEPTION 'Príkaz je v stave „%" — záznamy nemožno meniť.', prikaz.status;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_run_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  stav_prikazu text;
  vykon_zmazany timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.press_run_id IS DISTINCT FROM OLD.press_run_id THEN
    RAISE EXCEPTION 'Väzba záznamu na výkon je nemenná.';
  END IF;

  SELECT wo.status, pr.deleted_at INTO stav_prikazu, vykon_zmazany
    FROM press_runs pr
    JOIN work_orders wo ON wo.id = pr.work_order_id
   WHERE pr.id = NEW.press_run_id
   FOR UPDATE OF wo;
  IF stav_prikazu IS NULL THEN
    RAISE EXCEPTION 'Výkon neexistuje.';
  END IF;
  -- Tombstoning detí je povolený (storno maže výkon pred deťmi).
  IF vykon_zmazany IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Výkon je stornovaný — záznamy naň nemožno pridávať.';
  END IF;
  IF stav_prikazu IN ('dokoncena', 'zrusena') THEN
    RAISE EXCEPTION 'Príkaz je v stave „%" — záznamy výkonu nemožno meniť.', stav_prikazu;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Dávku so živými výkonmi lisovne nemožno zmazať — inak by sa storno výkonov
-- natrvalo zabetónovalo (enforce_press_run by hlásil „nie je schválená").
CREATE FUNCTION forbid_batch_delete_with_press_runs() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM press_runs
       WHERE batch_id = NEW.id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Dávku so živými výkonmi lisovne nemožno zmazať.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER production_batches_press_delete_guard
BEFORE UPDATE ON production_batches
FOR EACH ROW EXECUTE FUNCTION forbid_batch_delete_with_press_runs();
