import { redirect } from "next/navigation";
import { db } from "@/db";
import { domovModul } from "@/server/rbac";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

// Domov presmeruje na modul podľa roly (ekonom/admin → faktúry, majster
// valcovne → výroba, laborant → labák). Rola bez modulu (majster_lisovne v F1)
// vidí neutrálnu hlášku namiesto redirectu (žiadny loop).
export default async function Home() {
  const user = await getCurrentUser(db);
  const domov = domovModul(user.role);
  if (domov) redirect(domov);

  return (
    <div className="mx-auto max-w-lg pt-24 text-center text-muted-foreground">
      Vitaj, {user.displayName}. Tvojej role zatiaľ nie je pridelený žiadny
      modul.
    </div>
  );
}
