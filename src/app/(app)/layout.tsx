import { HelpCircle } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { LogoutButton } from "@/components/logout-button";
import { db } from "@/db";
import { ROLY } from "@/lib/enums";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

// Shell chránenej časti appky: vyžaduje prihlásenie (getCurrentUser → /login)
// a je zdrojom roly pre navigáciu. RBAC per modul rieši per-modul layout
// (src/app/(app)/<modul>/layout.tsx → vyzadajModul) — spoľahlivo pri mounte
// segmentu, na rozdiel od tohto layoutu, ktorý sa pri soft-navigácii neopakuje.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser(db);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar px-3 py-5 print:hidden">
        <div className="mb-6 px-3">
          <div className="text-lg font-semibold tracking-tight">BAMIPA</div>
          <div className="text-xs text-muted-foreground">
            výrobno-nákladový systém
          </div>
        </div>
        <AppNav role={user.role} />
        <div className="mt-auto border-t pt-4">
          <a
            href="/manual.html"
            target="_blank"
            rel="noopener noreferrer"
            className="mb-3 flex w-full items-center justify-start gap-2 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
          >
            <HelpCircle className="h-4 w-4" />
            Manuál
          </a>
          <div className="px-3 pb-2">
            <div className="truncate text-sm font-medium">{user.displayName}</div>
            <div className="text-xs text-muted-foreground">{ROLY[user.role]}</div>
          </div>
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto px-8 py-6 print:overflow-visible print:p-0">
        {children}
      </main>
    </div>
  );
}
