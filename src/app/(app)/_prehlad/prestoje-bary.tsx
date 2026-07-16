// Prestoje per dôvod a per stroj (SPEC M8, Q5) — horizontálne bar listy.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PrestojRiadok } from "@/server/dashboard/queries";
import { BarList } from "./bar-list";
import { formatMinuty } from "./format";

const PREVADZKA: Record<string, string> = {
  valcovna: "valcovňa",
  lisovna: "lisovňa",
};

export function PrestojeBary({ riadky }: { riadky: PrestojRiadok[] }) {
  const podlaDovodu = new Map<string, number>();
  const podlaStroja = new Map<string, { prevadzka: string; minutes: number }>();
  for (const r of riadky) {
    podlaDovodu.set(r.reasonName, (podlaDovodu.get(r.reasonName) ?? 0) + r.minutes);
    const stroj = podlaStroja.get(r.machineCode) ?? {
      prevadzka: r.prevadzka,
      minutes: 0,
    };
    stroj.minutes += r.minutes;
    podlaStroja.set(r.machineCode, stroj);
  }
  const dovody = [...podlaDovodu.entries()]
    .map(([label, min]) => ({ label, hodnota: formatMinuty(min), mnozstvo: min }))
    .sort((a, b) => b.mnozstvo - a.mnozstvo);
  const stroje = [...podlaStroja.entries()]
    .map(([label, s]) => ({
      label,
      poznamka: PREVADZKA[s.prevadzka] ?? s.prevadzka,
      hodnota: formatMinuty(s.minutes),
      mnozstvo: s.minutes,
    }))
    .sort((a, b) => b.mnozstvo - a.mnozstvo);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prestoje</CardTitle>
      </CardHeader>
      <CardContent>
        {riadky.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Žiadne prestoje vo zvolenom období.
          </p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <BarList titulok="Podľa dôvodu" polozky={dovody} />
            <BarList titulok="Podľa stroja" polozky={stroje} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
