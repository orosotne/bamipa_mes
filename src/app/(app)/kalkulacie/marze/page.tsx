import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { formatCentsToEur, zobrazQty } from "@/lib/format";
import { marzeArtiklov } from "@/server/calc/margins";

export const dynamic = "force-dynamic";

/** "469.40" (centy, 2 des.) → "4,69 €" (zaokrúhlené na cent pre zobrazenie). */
function eurZDvojDesCentov(cents2: string | null): string {
  if (cents2 === null) return "—";
  return formatCentsToEur(Math.round(Number(cents2)));
}

export default async function MarzePage() {
  const marze = await marzeArtiklov(db);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <Link
          href="/kalkulacie"
          className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Kalkulácie
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Marže artiklov — teoretická vs. skutočná
        </h1>
        <p className="text-sm text-muted-foreground">
          Skutočný náklad = vážený priemer dokončených príkazov s uzavretou
          kalkuláciou. Teoretická zmes = norma kg/pár × materiál receptu podľa
          aktuálnych skladových cien.
        </p>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Artikel</TableHead>
              <TableHead className="text-right">Predajná cena</TableHead>
              <TableHead className="text-right">Náklad/pár</TableHead>
              <TableHead className="text-right">Marža</TableHead>
              <TableHead className="text-right">Marža %</TableHead>
              <TableHead className="text-right">Dobré páry</TableHead>
              <TableHead className="text-right">Zmes teor.</TableHead>
              <TableHead className="text-right">Zmes skut.</TableHead>
              <TableHead className="text-right">Norma kg/pár</TableHead>
              <TableHead className="text-right">Skut. kg/pár</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {marze.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  Žiadne aktívne artikle.
                </TableCell>
              </TableRow>
            ) : (
              marze.map((m) => (
                <TableRow key={m.soleModelId}>
                  <TableCell className="font-medium">
                    {m.code} — {m.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.salePriceCents === null
                      ? "—"
                      : formatCentsToEur(m.salePriceCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {eurZDvojDesCentov(m.costPerPairCents)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {eurZDvojDesCentov(m.marginCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.marginPct === null ? "—" : `${zobrazQty(m.marginPct)} %`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.dobreParov}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.teoretickaZmesCents === null
                      ? "—"
                      : formatCentsToEur(m.teoretickaZmesCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {eurZDvojDesCentov(m.skutocnaZmesCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {zobrazQty(m.normaKgNaPar)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.skutocnaKgNaPar === null ? "—" : zobrazQty(m.skutocnaKgNaPar)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
