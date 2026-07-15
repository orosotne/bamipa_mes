import { asc, isNull } from "drizzle-orm";
import { ArrowLeft, Euro, Scale } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { KATEGORIE_MATERIALOV } from "@/lib/enums";
import { formatDatum, formatPriceToEurPerUnit, zobrazQty } from "@/lib/format";
import { cenovaHistoria, detailMaterialu } from "@/server/warehouse/queries";
import { cn } from "@/lib/utils";
import { CorrectionDialog } from "./correction-dialog";
import { MaterialCorrectionDialog } from "./material-correction-dialog";
import { PriceChart } from "./price-chart";
import { PriceCorrectionDialog } from "./price-correction-dialog";

export const dynamic = "force-dynamic";

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof detailMaterialu>>;
  try {
    detail = await detailMaterialu(db, id);
  } catch {
    notFound();
  }

  const [historia, strediska] = await Promise.all([
    cenovaHistoria(db, id),
    db
      .select({ id: schema.costCenters.id, name: schema.costCenters.name })
      .from(schema.costCenters)
      .where(isNull(schema.costCenters.deletedAt))
      .orderBy(asc(schema.costCenters.name)),
  ]);

  const m = detail.material;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center gap-4">
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
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {m.code}
            <Badge variant="outline">{KATEGORIE_MATERIALOV[m.category]}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {m.name} · MJ: {m.unit}
            {m.minStockQty && ` · min. zásoba ${zobrazQty(m.minStockQty)} ${m.unit}`}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vývoj nákupnej ceny (€/{m.unit})</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceChart body={historia} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Šarže (FIFO poradie čerpania)</CardTitle>
          {detail.loty.length > 0 && (
            <CardAction>
              <MaterialCorrectionDialog
                materialId={m.id}
                materialCode={m.code}
                unit={m.unit}
                strediska={strediska}
                trigger={
                  <Button variant="outline" size="sm">
                    <Scale className="h-3.5 w-3.5" />
                    Inventúrne manko
                  </Button>
                }
              />
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {detail.loty.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Žiadne šarže — materiál zatiaľ nebol prijatý na sklad.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Príjemka</TableHead>
                  <TableHead>Dátum</TableHead>
                  <TableHead>Dodávateľ</TableHead>
                  <TableHead>Šarža dodávateľa</TableHead>
                  <TableHead className="text-right">Prijaté</TableHead>
                  <TableHead className="text-right">Zostatok</TableHead>
                  <TableHead className="text-right">Cena/{m.unit}</TableHead>
                  <TableHead className="w-20 text-right">Akcie</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.loty.map((lot) => {
                  const vycerpany = Number(lot.qtyRemaining) === 0;
                  return (
                    <TableRow
                      key={lot.id}
                      className={cn(vycerpany && "text-muted-foreground")}
                    >
                      <TableCell>{lot.receiptNumber}</TableCell>
                      <TableCell>{formatDatum(lot.receivedAt)}</TableCell>
                      <TableCell>{lot.supplierName ?? "—"}</TableCell>
                      <TableCell>{lot.supplierLotCode ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {zobrazQty(lot.qtyReceived)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          !vycerpany && "font-medium",
                        )}
                      >
                        {zobrazQty(lot.qtyRemaining)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPriceToEurPerUnit(lot.unitPrice)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <PriceCorrectionDialog
                            lotId={lot.id}
                            materialId={m.id}
                            receiptNumber={lot.receiptNumber}
                            unit={m.unit}
                            unitPrice={lot.unitPrice}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Cenová korekcia"
                              >
                                <Euro className="h-4 w-4" />
                              </Button>
                            }
                          />
                          <CorrectionDialog
                            lotId={lot.id}
                            materialId={m.id}
                            receiptNumber={lot.receiptNumber}
                            unit={m.unit}
                            strediska={strediska}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Inventúrna korekcia"
                              >
                                <Scale className="h-4 w-4" />
                              </Button>
                            }
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
