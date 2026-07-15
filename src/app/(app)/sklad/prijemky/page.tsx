import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { ZDROJE_PRIJEMKY } from "@/lib/enums";
import { formatCentsToEur, formatDatum } from "@/lib/format";
import { zoznamPrijemok } from "@/server/warehouse/queries";

export const dynamic = "force-dynamic";

export default async function PrijemkyPage() {
  const prijemky = await zoznamPrijemok(db);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Späť na sklad"
            nativeButton={false}
            render={<Link href="/sklad" />}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Príjemky</h1>
            <p className="text-sm text-muted-foreground">
              Príjmy na sklad — z faktúr vznikajú šarže s dokladovou cenou.
            </p>
          </div>
        </div>
        <Button nativeButton={false} render={<Link href="/sklad/prijemky/nova" />}>
          <Plus className="h-4 w-4" /> Nová príjemka
        </Button>
      </div>

      {prijemky.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Zatiaľ žiadne príjemky — začni tlačidlom „Nová príjemka“.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo</TableHead>
                <TableHead>Dátum príjmu</TableHead>
                <TableHead>Zdroj</TableHead>
                <TableHead>Faktúra</TableHead>
                <TableHead>Dodávateľ</TableHead>
                <TableHead className="text-right">Šarže</TableHead>
                <TableHead className="text-right">Hodnota</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prijemky.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.receiptNumber}</TableCell>
                  <TableCell>{formatDatum(p.receivedAt)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{ZDROJE_PRIJEMKY[p.source]}</Badge>
                  </TableCell>
                  <TableCell>
                    {p.invoiceId && p.invoiceNumber ? (
                      <Link
                        href={`/faktury/${p.invoiceId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {p.invoiceNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{p.supplierName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.pocetSarzi}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCentsToEur(p.hodnotaCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
