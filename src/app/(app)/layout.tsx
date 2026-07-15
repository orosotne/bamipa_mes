import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { LogoutButton } from "@/components/logout-button";
import { db } from "@/db";
import { ROLY } from "@/lib/enums";
import { smieVidietRoute } from "@/server/rbac";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

// Shell chránenej časti appky: vyžaduje prihlásenie (getCurrentUser → /login) a
// vynúti RBAC per routa (pathname z Proxy hlavičky x-pathname). Neprihlásených
// zachytí už Proxy; toto je druhá vrstva + zdroj roly pre navigáciu.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser(db);

  const pathname = (await headers()).get("x-pathname") ?? "/";
  if (!smieVidietRoute(user.role, pathname)) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar px-3 py-5">
        <div className="mb-6 px-3">
          <div className="text-lg font-semibold tracking-tight">BAMIPA</div>
          <div className="text-xs text-muted-foreground">
            výrobno-nákladový systém
          </div>
        </div>
        <AppNav role={user.role} />
        <div className="mt-auto border-t pt-4">
          <div className="px-3 pb-2">
            <div className="truncate text-sm font-medium">{user.displayName}</div>
            <div className="text-xs text-muted-foreground">{ROLY[user.role]}</div>
          </div>
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto px-8 py-6">{children}</main>
    </div>
  );
}
