import { Badge } from "@/components/ui/badge";
import { STAVY_DAVOK, type StavDavky } from "@/lib/enums";
import { cn } from "@/lib/utils";

const FARBY: Record<StavDavky, string> = {
  rozpracovana: "bg-muted text-muted-foreground",
  caka_na_labak: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  schvalena: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  zamietnuta: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function BatchStatusBadge({ stav }: { stav: StavDavky }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", FARBY[stav])}>
      {STAVY_DAVOK[stav]}
    </Badge>
  );
}
