import { ArrowLeft, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import {
  formatCentsToEur,
  formatDatum,
  formatPriceToEurPerUnit,
  zobrazQty,
} from "@/lib/format";
import { teoretickaKalkulacia } from "@/server/inventory/theoretical";
import { limityPreZmes } from "@/server/lab/definitions";
import { detailZmesi } from "@/server/mixtures/queries";
import { cn } from "@/lib/utils";
import { ActivateButton } from "./activate-button";
import { LimitsSection } from "./limits-section";

export const dynamic = "force-dynamic";

export default async function ZmesDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ verzia?: string }>;
}) {
  const { id } = await params;
  const { verzia } = await searchParams;

  let detail: Awaited<ReturnType<typeof detailZmesi>>;
  try {
    detail = await detailZmesi(db, id, verzia ? Number(verzia) : undefined);
  } catch {
    notFound();
  }

  const kalkulacia = detail.zvolena
    ? await teoretickaKalkulacia(db, { recipeId: detail.zvolena.recipe.id })
    : null;

  const limity = await limityPreZmes(db, id);

  const stdKg = detail.zvolena
    ? Number(detail.zvolena.recipe.standardBatchKg)
    : 0;
  const cenaZaKg =
    kalkulacia && stdKg > 0
      ? Number(kalkulacia.materialCentsSpolu) / stdKg
      : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Späť na receptúry"
            nativeButton={false}
            render={<Link href="/receptury" />}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {detail.zmes.code}
            </h1>
            <p className="text-sm text-muted-foreground">
              {detail.zmes.name}
              {detail.zmes.note && ` · ${detail.zmes.note}`}
            </p>
          </div>
        </div>
        <Button
          nativeButton={false}
          render={
            <Link
              href={`/receptury/${id}/nova-verzia${
                detail.zvolena ? `?verzia=${detail.zvolena.recipe.version}` : ""
              }`}
            />
          }
        >
          <Plus className="h-4 w-4" /> Nová verzia
        </Button>
      </div>

      {detail.verzie.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Zmes zatiaľ nemá receptúru — vytvor prvú verziu.
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Verzie:</span>
            {detail.verzie.map((v) => {
              const jeZvolena = v.version === detail.zvolena?.recipe.version;
              return (
                <Button
                  key={v.id}
                  size="sm"
                  variant={jeZvolena ? "default" : "outline"}
                  nativeButton={false}
                  render={
                    <Link href={`/receptury/${id}?verzia=${v.version}`} />
                  }
                >
                  v{v.version}
                  {v.isActive && " ★"}
                </Button>
              );
            })}
          </div>

          {detail.zvolena && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Verzia {detail.zvolena.recipe.version}
                  {detail.zvolena.recipe.isActive
                    ? " (aktívna)"
                    : " (neaktívna — dávky sa robia z aktívnej ★)"}
                  {" · vytvorená "}
                  {new Intl.DateTimeFormat("sk-SK", {
                    timeZone: "Europe/Bratislava",
                    dateStyle: "medium",
                  }).format(detail.zvolena.recipe.createdAt)}
                  {" · štandardná dávka "}
                  {zobrazQty(detail.zvolena.recipe.standardBatchKg)} kg
                </p>
                {!detail.zvolena.recipe.isActive && (
                  <ActivateButton
                    mixtureId={id}
                    recipeId={detail.zvolena.recipe.id}
                    version={detail.zvolena.recipe.version}
                  />
                )}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>
                    Živá teoretická kalkulácia (aktuálne FIFO ceny skladu)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Materiál</TableHead>
                        <TableHead className="text-right">
                          Množstvo na dávku
                        </TableHead>
                        <TableHead className="text-right">Náklad (FIFO)</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kalkulacia?.polozky.map((p) => (
                        <TableRow
                          key={p.materialId}
                          className={cn(p.maNedostatok && "bg-amber-50 dark:bg-amber-950/30")}
                        >
                          <TableCell>
                            <span className="font-medium">{p.materialCode}</span>{" "}
                            <span className="text-muted-foreground">
                              {p.materialName}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {zobrazQty(p.qtyKg)} kg
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.maNedostatok && Number(p.materialCents) === 0 ? (
                              <span className="text-muted-foreground">
                                bez skladovej ceny
                              </span>
                            ) : (
                              formatCentsToEur(Number(p.materialCents))
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-amber-600">
                            {p.maNedostatok && (
                              <>
                                <TriangleAlert className="mr-1 inline h-3.5 w-3.5" />
                                chýba {zobrazQty(p.chybaKg ?? "0")} kg na sklade
                              </>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Separator className="my-3" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      Materiál spolu na dávku (
                      {zobrazQty(detail.zvolena.recipe.standardBatchKg)} kg)
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatCentsToEur(Number(kalkulacia?.materialCentsSpolu ?? 0n))}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Teoretický materiálový náklad na 1 kg zmesi
                    </span>
                    <span className="font-semibold tabular-nums">
                      {cenaZaKg !== null
                        ? `${formatPriceToEurPerUnit(cenaZaKg.toFixed(4))}/kg`
                        : "—"}
                    </span>
                  </div>
                  {kalkulacia?.maNedostatok && (
                    <p className="mt-3 text-xs font-medium text-amber-600">
                      ⚠ Sklad nepokrýva celú dávku — chýbajúce množstvá sú ocenené
                      cenou najnovšej šarže (informatívne).
                    </p>
                  )}
                </CardContent>
              </Card>

              {detail.zvolena.recipe.techNotes && (
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle>Technologické poznámky</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm whitespace-pre-wrap">
                    {detail.zvolena.recipe.techNotes}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}

      <LimitsSection mixtureId={id} limity={limity} />
    </div>
  );
}
