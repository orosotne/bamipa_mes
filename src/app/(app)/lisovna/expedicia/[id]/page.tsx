import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { detailDodacieho } from "@/server/press/queries";
import { StornoShipmentButton } from "./storno-shipment-button";

export const dynamic = "force-dynamic";

export default async function DodaciDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof detailDodacieho>>;
  try {
    detail = await detailDodacieho(db, id);
  } catch {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Späť na expedíciu"
          nativeButton={false}
          render={<Link href="/lisovna/expedicia" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex flex-1 items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {detail.dodaci.shipmentNumber}
          </h1>
        </div>
        <StornoShipmentButton
          id={detail.dodaci.id}
          cislo={detail.dodaci.shipmentNumber}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Údaje dodacieho listu</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Dátum expedície</div>
            <div className="font-medium">{formatDatum(detail.dodaci.shipDate)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Odberateľ</div>
            <div className="font-medium">{detail.dodaci.customer}</div>
          </div>
          {detail.dodaci.note && (
            <div>
              <div className="text-muted-foreground">Poznámka</div>
              <div className="font-medium">{detail.dodaci.note}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Položky a traceabilita</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Výrobný príkaz</TableHead>
                <TableHead>Artikel</TableHead>
                <TableHead className="text-right">Páry</TableHead>
                <TableHead>Dávky zmesi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.polozky.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/lisovna/${p.workOrderId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {p.orderNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {p.artikelCode} — {p.artikelName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.qtyPairs}
                  </TableCell>
                  <TableCell>
                    {p.davky.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {p.davky.map((d) => (
                          <Badge
                            key={d.batchId}
                            variant="outline"
                            render={
                              <Link
                                href={`/vyroba/${d.batchId}`}
                                className="hover:bg-muted"
                              />
                            }
                          >
                            {d.batchNumber}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Traceabilita: dodávka → výrobný príkaz → dávka zmesi → šarže surovín
            (na detaile dávky) → faktúry dodávateľov.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
