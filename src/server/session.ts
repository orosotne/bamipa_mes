// DECISION-PENDING (D9 — Auth): dočasný session stub do zavedenia Supabase Auth.
// Vracia prvého aktívneho admina — na dev DB je to seedovaný „Dev Admin".
// Auth krok tento súbor nahradí čítaním Supabase session (users.id = auth.users.id).
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";

export async function getCurrentUser(
  db: DbClient,
): Promise<typeof schema.users.$inferSelect> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.role, "admin"),
        eq(schema.users.isActive, true),
        isNull(schema.users.deletedAt),
      ),
    )
    .orderBy(asc(schema.users.createdAt))
    .limit(1);

  if (!user) {
    throw new Error(
      "Žiadny aktívny admin v databáze — spusti dev DB (npm run dev:db) alebo seed.",
    );
  }
  return user;
}

/** Dnešný dátum (YYYY-MM-DD) v Europe/Bratislava — jediné miesto s „teraz". */
export function dnesnyDatum(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/Bratislava",
  });
}
