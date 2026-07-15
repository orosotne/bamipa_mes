// Aktuálny používateľ z Supabase Auth session. getClaims() validuje JWT podpis
// (na rozdiel od getSession, ktorému sa v server kóde nesmie veriť). Rola pre
// autorizáciu sa berie VÝHRADNE z DB users.role (join podľa auth id = users.id),
// NIE z JWT/user_metadata (user-editovateľné).
import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { DbClient } from "@/db";
import * as schema from "@/db/schema";
import type { UserRole } from "@/lib/enums";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { overRolu } from "@/server/rbac";

/** Aktívny (nezmazaný) používateľ podľa auth id, alebo null. Testovateľné. */
export async function pouzivatelPodlaId(
  db: DbClient,
  id: string,
): Promise<typeof schema.users.$inferSelect | null> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.id, id),
        eq(schema.users.isActive, true),
        isNull(schema.users.deletedAt),
      ),
    );
  return user ?? null;
}

/**
 * Prihlásený používateľ (s rolou) pre Server Components a server actions.
 * Bez platnej session alebo bez zodpovedajúceho aktívneho záznamu v users →
 * redirect na /login (Proxy to drží aj na úrovni routovania).
 */
export async function getCurrentUser(
  db: DbClient,
): Promise<typeof schema.users.$inferSelect> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) redirect("/login");

  const user = await pouzivatelPodlaId(db, sub);
  if (!user) redirect("/login");
  return user;
}

/**
 * Prihlásený používateľ + overenie roly pre server actions (jeden krok).
 * Bez uvedenia povolených rolí = len admin. Admin prejde vždy.
 */
export async function vyzadajRolu(
  db: DbClient,
  ...povolene: UserRole[]
): Promise<typeof schema.users.$inferSelect> {
  const user = await getCurrentUser(db);
  overRolu(user.role, ...povolene);
  return user;
}

/** Dnešný dátum (YYYY-MM-DD) v Europe/Bratislava — jediné miesto s „teraz". */
export function dnesnyDatum(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/Bratislava",
  });
}
