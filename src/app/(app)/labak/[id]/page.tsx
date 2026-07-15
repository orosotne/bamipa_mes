import { ArrowLeft, CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { VERDIKTY } from "@/lib/enums";
import { zobrazQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { detailPreLabak } from "@/server/lab/queries";
import { BatchStatusBadge } from "../../vyroba/batch-status-badge";
import { MeasurementForm } from "./measurement-form";
import { VerdictPanel } from "./verdict-panel";

export const dynamic = "force-dynamic";

function formatCas(d: Date): string {
  return new Intl.DateTimeFormat("sk-SK", {
    timeZone: "Europe/Bratislava",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function limitPopis(min: string | null, max: string | null): string {
  if (min !== null && max !== null)
    return `${zobrazQty(min)} – ${zobrazQty(max)}`;
  if (min !== null) return `≥ ${zobrazQty(min)}`;
  if (max !== null) return `≤ ${zobrazQty(max)}`;
  return "—";
}

export default async function LabakDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof detailPreLabak>>;
  try {
    detail = await detailPreLabak(db, id);
  } catch {
    notFound();
  }

  const posledny = detail.testy.at(-1) ?? null;
  const otvoreny = posledny && posledny.verdict === null ? posledny : null;
  const status = detail.davka.status;
  const maDefinicie = detail.definicie.length > 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Späť na labák"
          nativeButton={false}
          render={<Link href="/labak" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {detail.davka.batchNumber}
          </h1>
          <BatchStatusBadge stav={status} />
          <span className="text-sm text-muted-foreground">
            {detail.mixtureCode} — {detail.mixtureName} · v{detail.recipeVersion}
            {detail.davka.outputKg &&
              ` · ${zobrazQty(detail.davka.outputKg)} kg`}
          </span>
        </div>
      </div>

      {/* Výsledok verdiktu (schválená/zamietnutá dávka) */}
      {status === "schvalena" && posledny && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="text-sm">
            <div className="font-medium text-emerald-800 dark:text-emerald-300">
              Dávka schválená — možno ju použiť v lisovni.
            </div>
            <div className="text-muted-foreground">
              {posledny.verdictByName}
              {posledny.verdictAt && ` · ${formatCas(posledny.verdictAt)}`}
            </div>
          </div>
        </div>
      )}
      {status === "zamietnuta" && posledny && (
        <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
          <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div className="flex-1 text-sm">
            <div className="font-medium text-red-800 dark:text-red-300">
              Dávka zamietnutá — blokovaná pre lisovňu.
            </div>
            <div className="text-muted-foreground">
              {posledny.verdictByName}
              {posledny.verdictAt && ` · ${formatCas(posledny.verdictAt)}`}
            </div>
            {detail.poslednaUprava?.description && (
              <div className="mt-2">
                <span className="text-muted-foreground">Inštrukcia na úpravu: </span>
                <span className="font-medium">
                  {detail.poslednaUprava.description}
                </span>
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              nativeButton={false}
              render={<Link href={`/vyroba/${id}`} />}
            >
              Prejsť na úpravu dávky (výroba)
            </Button>
          </div>
        </div>
      )}

      {/* Zmes bez definovaných limitov — merať nemožno */}
      {!maDefinicie && status === "caka_na_labak" && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <div className="font-medium text-amber-800 dark:text-amber-300">
              Zmes nemá definované limity labáku.
            </div>
            <div className="text-muted-foreground">
              Bez limitov sa dávka nedá merať — najprv ich nastav v receptúre.
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              nativeButton={false}
              render={<Link href={`/receptury/${detail.mixtureId}`} />}
            >
              Nastaviť limity zmesi
            </Button>
          </div>
        </div>
      )}

      {/* Aktívny krok: meranie alebo verdikt */}
      {status === "caka_na_labak" && maDefinicie && otvoreny && (
        <VerdictPanel
          batchId={id}
          labTestId={otvoreny.id}
          sequenceNo={otvoreny.sequenceNo}
          vysledky={otvoreny.vysledky}
        />
      )}
      {status === "caka_na_labak" && maDefinicie && !otvoreny && (
        <MeasurementForm batchId={id} definicie={detail.definicie} />
      )}

      {/* História meraní */}
      {detail.testy.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>História meraní</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {detail.testy.map((t) => (
              <div key={t.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">Meranie #{t.sequenceNo}</span>
                  <span className="text-muted-foreground">
                    {t.laborantName} · {formatCas(t.createdAt)}
                  </span>
                  {t.verdict ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        t.verdict === "schvalene"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
                      )}
                    >
                      {VERDIKTY[t.verdict]}
                      {t.verdictByName && ` · ${t.verdictByName}`}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      Bez verdiktu
                    </span>
                  )}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parameter</TableHead>
                      <TableHead className="text-right">Nameraná</TableHead>
                      <TableHead className="text-right">Limit (snapshot)</TableHead>
                      <TableHead className="text-right">Stav</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {t.vysledky.map((v) => (
                      <TableRow
                        key={v.parameterId}
                        className={cn(
                          !v.isWithinLimits && "bg-red-50 dark:bg-red-950/40",
                        )}
                      >
                        <TableCell>
                          <span className="font-medium">{v.parameterCode}</span>
                          {v.parameterUnit && (
                            <span className="text-muted-foreground">
                              {" "}
                              ({v.parameterUnit})
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {zobrazQty(v.value)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {limitPopis(v.minLimitSnapshot, v.maxLimitSnapshot)}
                        </TableCell>
                        <TableCell className="text-right">
                          {v.isWithinLimits ? (
                            <span className="text-emerald-600">v limite</span>
                          ) : (
                            <span className="font-semibold text-red-600">mimo</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
