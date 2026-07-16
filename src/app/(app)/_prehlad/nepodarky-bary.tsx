// Nepodarky per dôvod a per stroj (SPEC M8, Q5: „kde vznikajú nepodarky").
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { NepodarkyRiadok } from "@/server/dashboard/queries";
import { BarList } from "./bar-list";

const pary = (n: number) =>
  n === 1 ? "1 pár" : n < 5 ? `${n} páry` : `${n} párov`;

export function NepodarkyBary({ riadky }: { riadky: NepodarkyRiadok[] }) {
  const podlaDovodu = new Map<string, number>();
  const podlaStroja = new Map<string, number>();
  for (const r of riadky) {
    podlaDovodu.set(r.reasonName, (podlaDovodu.get(r.reasonName) ?? 0) + r.qtyPairs);
    podlaStroja.set(r.machineCode, (podlaStroja.get(r.machineCode) ?? 0) + r.qtyPairs);
  }
  const dovody = [...podlaDovodu.entries()]
    .map(([label, n]) => ({ label, hodnota: pary(n), mnozstvo: n }))
    .sort((a, b) => b.mnozstvo - a.mnozstvo);
  const stroje = [...podlaStroja.entries()]
    .map(([label, n]) => ({ label, hodnota: pary(n), mnozstvo: n }))
    .sort((a, b) => b.mnozstvo - a.mnozstvo);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nepodarky</CardTitle>
      </CardHeader>
      <CardContent>
        {riadky.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Žiadne nepodarky vo zvolenom období.
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
