// src/db/seed.ts — idempotentný seed číselníkov (F1) pre REÁLNU DB (Supabase).
// Spustenie: npm run db:seed
//
// PREDPOKLADY (poradie je záväzné — viď návrh schémy, bootstrap pravidlo):
// 1. Migrácie aplikované (npm run db:migrate).
// 2. Prvý admin založený v Supabase Auth (dashboard) — jeho auth id sa
//    zadá cez SEED_ADMIN_ID; users.id sa NIKDY negeneruje lokálne.
// 3. .env.local: DIRECT_URL (alebo DATABASE_URL), SEED_ADMIN_ID,
//    SEED_ADMIN_EMAIL, SEED_ADMIN_NAME.
//
// Pre lokálnu dev DB (PGlite) sa seed púšťa automaticky v scripts/dev-db.ts.

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { seedZakladneCiselniky } from "./seed-data";

config({ path: ".env.local" });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("DIRECT_URL ani DATABASE_URL nie je nastavená (.env.local).");
}

const adminId = process.env.SEED_ADMIN_ID;
if (!adminId || adminId.includes("[")) {
  throw new Error(
    "SEED_ADMIN_ID nie je nastavené — založ admina v Supabase Auth a vlož jeho auth id do .env.local.",
  );
}

const client = postgres(url, { prepare: false, max: 1 });
const db = drizzle(client, { schema });

seedZakladneCiselniky(db, {
  id: adminId,
  email: process.env.SEED_ADMIN_EMAIL ?? null,
  displayName: process.env.SEED_ADMIN_NAME ?? "Admin",
})
  .then(() => {
    console.log(
      "Seed hotový: 1 admin, 4 strediská, 4 dôvody prestojov, 7 QC parametrov.",
    );
  })
  .catch((err) => {
    console.error("Seed zlyhal:", err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
