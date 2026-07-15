import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit beží mimo Next.js, preto si .env.local musíme načítať sami.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrácie bežia cez PRIAME / session spojenie (port 5432), nie cez
    // transaction pooler (6543) – session/direct podporuje prepared
    // statements aj čisté DDL. Fallback na DATABASE_URL, ak DIRECT_URL chýba.
    url: (process.env.DIRECT_URL ?? process.env.DATABASE_URL)!,
  },
});
