// Cash-flow (SPEC M8, Q3): faktúry po splatnosti VIDITEĽNÉ BEZ KLIKU
// (akceptačné kritérium §12) + kalendár splatností po týždňoch dopredu.
import { CheckCircle2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCentsToEur, formatDatum } from "@/lib/format";
import type { CashflowBuckety } from "@/server/dashboard/queries";
import type { RiadokZoznamuFaktur } from "@/server/invoices/service";

const MAX_RIADKOV = 8;

export function PoSplatnostiAlert({
  faktury,
}: {
  faktury: RiadokZoznamuFaktur[];
}) {
  if (faktury.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
        Žiadne faktúry po splatnosti.
      </div>
    );
  }

  const suma = faktury.reduce((s, f) => s + f.zostatokCents, 0);
  const zobrazene = faktury.slice(0, MAX_RIADKOV);

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
      <div className="flex items-center gap-2 px-4 pt-4 font-semibold text-red-700 dark:text-red-400">
        <TriangleAlert className="h-4 w-4" aria-hidden />
        Po splatnosti: {faktury.length}{" "}
        {faktury.length === 1 ? "faktúra" : faktury.length < 5 ? "faktúry" : "faktúr"}{" "}
        za {formatCentsToEur(suma)}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Číslo</TableHead>
            <TableHead>Dodávateľ</TableHead>
            <TableHead>Splatnosť</TableHead>
            <TableHead className="text-right">Zostatok</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {zobrazene.map((f) => (
            <TableRow key={f.id}>
              <TableCell>
                <Link
                  href={`/faktury/${f.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {f.invoiceNumber}
                </Link>
              </TableCell>
              <TableCell>{f.supplierName}</TableCell>
              <TableCell className="font-semibold text-red-600">
                {formatDatum(f.dueDate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCentsToEur(f.zostatokCents)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {faktury.length > MAX_RIADKOV && (
        <div className="px-4 pb-3 text-sm">
          <Link
            href="/faktury?filter=po_splatnosti"
            className="text-red-700 underline-offset-4 hover:underline dark:text-red-400"
          >
            …a ďalších {faktury.length - MAX_RIADKOV} vo Faktúrach
          </Link>
        </div>
      )}
    </div>
  );
}

export function CashflowKalendar({
  buckety,
}: {
  buckety: CashflowBuckety<RiadokZoznamuFaktur>;
}) {
  const dlazdice = [
    ...buckety.tyzdne.map((t, i) => ({
      label: i === 0 ? "Tento týždeň" : `+${i}. týždeň`,
      rozsah: `${formatDatum(t.od)} – ${formatDatum(t.do)}`,
      sumaCents: t.sumaCents,
      pocet: t.pocet,
    })),
    {
      label: "Neskôr",
      rozsah: `od ${formatDatum(buckety.neskor.od)}`,
      sumaCents: buckety.neskor.sumaCents,
      pocet: buckety.neskor.pocet,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cash-flow kalendár — splatnosti dopredu</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {dlazdice.map((d) => (
            <Link
              key={d.label}
              href="/faktury"
              className="rounded-lg border p-3 transition-colors hover:bg-muted"
            >
              <div className="text-sm text-muted-foreground">{d.label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {formatCentsToEur(d.sumaCents)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {d.pocet === 1 ? "1 faktúra" : `${d.pocet} faktúr`} · {d.rozsah}
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
