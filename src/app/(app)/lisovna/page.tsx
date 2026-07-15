import { Footprints, Plus, Truck } from "lucide-react";
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
import { zobrazQty } from "@/lib/format";
import { zoznamPrikazov } from "@/server/press/queries";
import { WorkOrderStatusBadge } from "./work-order-status-badge";

export const dynamic = "force-dynamic";

export default async function LisovnaPage() {
  const prikazy = await zoznamPrikazov(db);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Lisovňa — výrobné príkazy
          </h1>
          <p className="text-sm text-muted-foreground">
            Výkony lisov, nepodarky, orez a expedícia podošiev.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href="/lisovna/artikle" />}
          >
            <Footprints className="h-4 w-4" /> Artikle
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href="/lisovna/expedicia" />}
          >
            <Truck className="h-4 w-4" /> Expedícia
          </Button>
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href="/lisovna/novy" />}
          >
            <Plus className="h-4 w-4" /> Nový príkaz
          </Button>
        </div>
      </div>

      {prikazy.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Zatiaľ žiadne výrobné príkazy — začni tlačidlom „Nový príkaz“.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo príkazu</TableHead>
                <TableHead>Artikel</TableHead>
                <TableHead className="text-right">Plán párov</TableHead>
                <TableHead className="text-right">Vyrobené (dobré)</TableHead>
                <TableHead className="text-right">Nepodarky</TableHead>
                <TableHead className="text-right">Orez kg</TableHead>
                <TableHead className="text-right">Expedované</TableHead>
                <TableHead>Stav</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prikazy.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/lisovna/${p.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {p.orderNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {p.artikelCode} — {p.artikelName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.qtyPairsPlanned}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.vyrobenePary}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.nepodarkyPary}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {zobrazQty(p.orezKg)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.expedovanePary}
                  </TableCell>
                  <TableCell>
                    <WorkOrderStatusBadge stav={p.status} />
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
