-- POZOR pred aplikáciou na prod (db:migrate): CREATE UNIQUE INDEX ZLYHÁ, ak už
-- existujú aktívni duplicitní dodávatelia. Najprv over prázdny výstup týchto
-- dvoch SELECTov a prípadné duplicity vyrieš (zluč / soft-delete):
--   SELECT lower(trim(name)) k, count(*) FROM suppliers WHERE deleted_at IS NULL
--     GROUP BY 1 HAVING count(*) > 1;
--   SELECT ico, count(*) FROM suppliers WHERE deleted_at IS NULL AND ico <> ''
--     GROUP BY 1 HAVING count(*) > 1;
CREATE UNIQUE INDEX "suppliers_ico_uq" ON "suppliers" USING btree ("ico") WHERE deleted_at IS NULL AND ico IS NOT NULL AND ico <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_uq" ON "suppliers" USING btree (lower(trim("name"))) WHERE deleted_at IS NULL;