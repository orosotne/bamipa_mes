// Kompaktné marže per artikel (SPEC M8, Q2) — detail v /kalkulacie/marze.
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCentsToEur, zobrazQty } from "@/lib/format";
import type { MarzaArtikla } from "@/server/calc/margins";
import { cn } from "@/lib/utils";
import { eurZDvojDesCentov } from "./format";

export function MarzeTabulka({ marze }: { marze: MarzaArtikla[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Marže per artikel</CardTitle>
        <CardAction>
          <Link
            href="/kalkulacie/marze"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Detail <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {marze.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žiadne aktívne artikle.</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artikel</TableHead>
                  <TableHead className="text-right">Predajná cena</TableHead>
                  <TableHead className="text-right">Náklad/pár</TableHead>
                  <TableHead className="text-right">Marža</TableHead>
                  <TableHead className="text-right">Marža %</TableHead>
                  <TableHead className="text-right">Norma kg/pár</TableHead>
                  <TableHead className="text-right">Skut. kg/pár</TableHead>
                  <TableHead className="text-right">Nadspotreba</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {marze.map((m) => {
                  const zaporna =
                    m.marginCents !== null && Number(m.marginCents) < 0;
                  // Nadspotreba zmesi (Q5): skutočná vs. normovaná spotreba
                  // na pár v % — len zobrazenie, počíta sa z 3-des. kg.
                  const nadspotrebaPct =
                    m.skutocnaKgNaPar === null
                      ? null
                      : ((Number(m.skutocnaKgNaPar) - Number(m.normaKgNaPar)) /
                          Number(m.normaKgNaPar)) *
                        100;
                  return (
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
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          zaporna && "text-red-600",
                        )}
                      >
                        {eurZDvojDesCentov(m.marginCents)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          zaporna && "text-red-600",
                        )}
                      >
                        {m.marginPct === null ? "—" : `${zobrazQty(m.marginPct)} %`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {zobrazQty(m.normaKgNaPar)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.skutocnaKgNaPar === null
                          ? "—"
                          : zobrazQty(m.skutocnaKgNaPar)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          nadspotrebaPct !== null &&
                            nadspotrebaPct > 0 &&
                            "text-red-600",
                        )}
                      >
                        {nadspotrebaPct === null
                          ? "—"
                          : `${nadspotrebaPct > 0 ? "+" : ""}${nadspotrebaPct
                              .toFixed(1)
                              .replace(".", ",")} %`}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
