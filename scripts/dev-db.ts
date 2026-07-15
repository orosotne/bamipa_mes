// Lokálna dev DB — PGlite servovaná cez Postgres wire protokol (pglite-socket).
// Spustenie: npm run dev:db  (port 5433, dáta v .pglite/ — gitignored)
//
// Prečo: Supabase projekt pre BAMIPA ešte neexistuje (free limit účtu).
// Aplikácia sa pripája ÚPLNE ROVNAKO ako na Supabase (postgres.js cez
// DATABASE_URL) — pri prechode na Supabase sa len vymení connection string
// v .env.local. Produkčný kód sa nemení.
//
// Pri štarte: aplikuje drizzle migrácie (oficiálny migrator — rovnaká
// __drizzle_migrations tabuľka ako npm run db:migrate) + idempotentný seed
// číselníkov s DEV adminom.

import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/db/schema";
import { seedZakladneCiselniky } from "../src/db/seed-data";

const PORT = 5433;
const DATA_DIR = ".pglite/data";
// Fixné dev-only UUID — pri prechode na Supabase Auth sa dev DB zahodí.
const DEV_ADMIN_ID = "a0000000-0000-4000-8000-000000000001";

async function main() {
  // PGlite nevytvára parent adresáre (non-recursive mkdir).
  mkdirSync(DATA_DIR, { recursive: true });
  const client = await PGlite.create({ dataDir: DATA_DIR });
  const db = drizzle(client, { schema });

  console.log("Aplikujem migrácie…");
  await migrate(db, { migrationsFolder: "./drizzle" });

  console.log("Seedujem číselníky (idempotentné)…");
  await seedZakladneCiselniky(db, {
    id: DEV_ADMIN_ID,
    email: "dev@bamipa.local",
    displayName: "Dev Admin",
  });

  const server = new PGLiteSocketServer({
    db: client,
    port: PORT,
    host: "127.0.0.1",
    // Next.js otvára paralelné spojenia (Promise.all, postgres.js pool) —
    // multiplexer ich serializuje nad jedinou PGlite konexiou.
    maxConnections: 10,
    inspect: process.env.DEVDB_DEBUG === "1",
  });
  await server.start();
  console.log(
    `Dev DB beží: postgres://postgres@localhost:${PORT}/postgres (dáta: ${DATA_DIR})`,
  );

  const shutdown = async () => {
    await server.stop();
    await client.close();
    console.log("Dev DB zastavená.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Dev DB zlyhala:", err);
  process.exit(1);
});
