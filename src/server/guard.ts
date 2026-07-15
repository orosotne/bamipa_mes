import { redirect } from "next/navigation";
import { db } from "@/db";
import { domovModul, type Modul, smieVidiet } from "@/server/rbac";
import { getCurrentUser } from "@/server/session";

/**
 * RBAC guard pre vstup do modulu — volá ho per-modul layout. Spoľahlivo sa
 * spustí pri MOUNTE route segmentu (aj pri soft-navigácii do modulu), na rozdiel
 * od (app) layoutu, ktorý sa medzi sesterskými routami neopakuje. Rolu bez
 * prístupu presmeruje na jej domovský modul (nie na route, ktorá by cyklila).
 */
export async function vyzadajModul(modul: Modul): Promise<void> {
  const user = await getCurrentUser(db);
  if (!smieVidiet(user.role, modul)) {
    redirect(domovModul(user.role) ?? "/");
  }
}
