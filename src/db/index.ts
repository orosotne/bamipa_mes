import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Spoločný typ pre postgres-js (prod), PGlite (testy) aj transakcie —
// služby (src/server/*) berú DB handle cez dependency injection.
export type DbClient = PgDatabase<PgQueryResultHKT, typeof schema>;

// Connection string sa NIKDY nehardcoduje – číta sa z .env.local (viď .env.example).
// Next.js načíta .env.local automaticky pri behu aplikácie.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL nie je nastavená (skontroluj .env.local).");
}

// DÔLEŽITÉ (Supabase): runtime beží cez Supavisor "Transaction" pooler
// (port 6543), ktorý NEPODPORUJE prepared statements – preto prepare: false.
// DB_POOL_MAX=1 v .env.local pre lokálnu dev DB (pglite-socket multiplexer
// nezvláda paralelné extended-protocol spojenia); Supabase beží s defaultom.
const client = postgres(connectionString, {
  prepare: false,
  max: Number(process.env.DB_POOL_MAX ?? "10"),
});

export const db = drizzle(client, { schema });
