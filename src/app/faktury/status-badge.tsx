import { Badge } from "@/components/ui/badge";
import { STAVY_FAKTUR, type StavFaktury } from "@/lib/enums";
import { cn } from "@/lib/utils";

const FARBY: Record<StavFaktury, string> = {
  nova: "bg-muted text-muted-foreground",
  schvalena: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  ciastocne_zaplatena:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  zaplatena:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

export function StatusBadge({ stav }: { stav: StavFaktury }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", FARBY[stav])}>
      {STAVY_FAKTUR[stav]}
    </Badge>
  );
}
