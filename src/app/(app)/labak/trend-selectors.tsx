"use client";

// M5 Labák — výber zmesi + parametra pre SPC trend. Zmena naviguje na /labak s
// query parametrami (server refetch dát grafu). Aktuálne hodnoty prídu z page
// ako props (žiadny useSearchParams → žiadny CSR bailout / Suspense).
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Zmes = { id: string; code: string; name: string };
type Parameter = { id: string; code: string; name: string };

export function TrendSelectors({
  zmesi,
  parametre,
  zvolenaZmes,
  zvolenyParam,
}: {
  zmesi: Zmes[];
  parametre: Parameter[];
  zvolenaZmes: string;
  zvolenyParam: string;
}) {
  const router = useRouter();

  function nav(zmes: string, param: string) {
    const q = new URLSearchParams();
    if (zmes) q.set("zmes", zmes);
    if (param) q.set("param", param);
    router.push(`/labak?${q.toString()}`);
  }

  const zmesItems = Object.fromEntries(
    zmesi.map((z) => [z.id, `${z.code} — ${z.name}`]),
  );
  const paramItems = Object.fromEntries(
    parametre.map((p) => [p.id, `${p.code} — ${p.name}`]),
  );

  return (
    <div className="flex flex-wrap gap-2">
      <Select
        items={zmesItems}
        value={zvolenaZmes}
        onValueChange={(v) => nav(v ?? "", zvolenyParam)}
      >
        <SelectTrigger className="h-10 min-w-52 text-sm">
          <SelectValue placeholder="Zmes" />
        </SelectTrigger>
        <SelectContent>
          {zmesi.map((z) => (
            <SelectItem key={z.id} value={z.id}>
              {z.code} — {z.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={paramItems}
        value={zvolenyParam}
        onValueChange={(v) => nav(zvolenaZmes, v ?? "")}
      >
        <SelectTrigger className="h-10 min-w-52 text-sm">
          <SelectValue placeholder="Parameter" />
        </SelectTrigger>
        <SelectContent>
          {parametre.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.code} — {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
