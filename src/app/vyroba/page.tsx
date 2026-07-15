import { Plus } from "lucide-react";
import Link from "next/link";
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
import { formatDatum } from "@/lib/format";
import { ZMENY } from "@/lib/enums";
import { zoznamDavok } from "@/server/batches/queries";
import { BatchStatusBadge } from "./batch-status-badge";

export const dynamic = "force-dynamic";

export default async function VyrobaPage() {
  const davky = await zoznamDavok(db);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Výroba — valcovňa</h1>
          <p className="text-sm text-muted-foreground">
            Výrobné dávky zmesí: navážka, časy, prestoje, náklad.
          </p>
        </div>
        <Button size="lg" nativeButton={false} render={<Link href="/vyroba/nova" />}>
          <Plus className="h-4 w-4" /> Nová dávka
        </Button>
      </div>

      {davky.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Zatiaľ žiadne dávky — začni tlačidlom „Nová dávka“.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo dávky</TableHead>
                <TableHead>Zmes</TableHead>
                <TableHead>Dátum</TableHead>
                <TableHead>Zmena</TableHead>
                <TableHead>Stroj</TableHead>
                <TableHead>Obsluha</TableHead>
                <TableHead>Stav</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {davky.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link
                      href={`/vyroba/${d.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {d.batchNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {d.mixtureCode} — {d.mixtureName}
                  </TableCell>
                  <TableCell>{formatDatum(d.productionDate)}</TableCell>
                  <TableCell>{ZMENY[d.shift as keyof typeof ZMENY] ?? d.shift}</TableCell>
                  <TableCell>{d.machineCode}</TableCell>
                  <TableCell>{d.leadWorkerName}</TableCell>
                  <TableCell>
                    <BatchStatusBadge stav={d.status} />
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
