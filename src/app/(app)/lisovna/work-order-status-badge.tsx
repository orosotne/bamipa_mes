import { Badge } from "@/components/ui/badge";
import { STAVY_PRIKAZOV, type StavPrikazu } from "@/lib/enums";
import { cn } from "@/lib/utils";

const FARBY: Record<StavPrikazu, string> = {
  nova: "bg-muted text-muted-foreground",
  vo_vyrobe: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  dokoncena:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  zrusena: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function WorkOrderStatusBadge({ stav }: { stav: string }) {
  const znamy = (stav in STAVY_PRIKAZOV ? stav : null) as StavPrikazu | null;
  if (!znamy) return <Badge variant="outline">{stav}</Badge>;
  return (
    <Badge variant="outline" className={cn("border-transparent", FARBY[znamy])}>
      {STAVY_PRIKAZOV[znamy]}
    </Badge>
  );
}
