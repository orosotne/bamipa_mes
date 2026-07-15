import { db } from "@/db";
import { getCurrentUser } from "@/server/session";
import { zoznamPouzivatelov } from "@/server/users/service";
import { UsersManager } from "./users-manager";

export const dynamic = "force-dynamic";

export default async function PouzivateliaPage() {
  const [user, pouzivatelia] = await Promise.all([
    getCurrentUser(db),
    zoznamPouzivatelov(db),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Používatelia</h1>
        <p className="text-sm text-muted-foreground">
          Správa účtov a rolí. Nový účet vytvorí prihlasovacie údaje v Supabase
          Auth a priradí rolu.
        </p>
      </div>
      <UsersManager pouzivatelia={pouzivatelia} currentUserId={user.id} />
    </div>
  );
}
