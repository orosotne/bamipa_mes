import { and, asc, eq, isNull } from "drizzle-orm";
import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ZMENY, type Zmena } from "@/lib/enums";
import { formatDatum, zobrazQty } from "@/lib/format";
import { frontaDavok, trendParametra } from "@/server/lab/queries";
import { zoznamZmesi } from "@/server/mixtures/queries";
import { TrendChart } from "./trend-chart";
import { TrendSelectors } from "./trend-selectors";

export const dynamic = "force-dynamic";

export default async function LabakPage({
  searchParams,
}: {
  searchParams: Promise<{ zmes?: string; param?: string }>;
}) {
  const { zmes, param } = await searchParams;

  const [fronta, zmesi, parametre] = await Promise.all([
    frontaDavok(db),
    zoznamZmesi(db),
    db
      .select({
        id: schema.labParameters.id,
        code: schema.labParameters.code,
        name: schema.labParameters.name,
        unit: schema.labParameters.unit,
      })
      .from(schema.labParameters)
      .where(
        and(
          eq(schema.labParameters.isActive, true),
          isNull(schema.labParameters.deletedAt),
        ),
      )
      .orderBy(asc(schema.labParameters.sortOrder)),
  ]);

  const zvolenaZmes = zmes ?? zmesi[0]?.id ?? "";
  const zvolenyParam = param ?? parametre[0]?.id ?? "";
  const zvolenyParamInfo = parametre.find((p) => p.id === zvolenyParam);

  const trend =
    zvolenaZmes && zvolenyParam
      ? await trendParametra(db, {
          mixtureId: zvolenaZmes,
          parameterId: zvolenyParam,
        })
      : null;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Labák — QC brána</h1>
        <p className="text-sm text-muted-foreground">
          Dávky čakajúce na meranie a verdikt. Bez verdiktu SCHVÁLENÉ sa dávka
          nedá použiť v lisovni.
        </p>
      </div>

      {fronta.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Žiadne dávky nečakajú na labák.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {fronta.map((d) => (
            <Link
              key={d.id}
              href={`/labak/${d.id}`}
              className="block rounded-xl border p-5 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-lg font-semibold">
                    <FlaskConical className="h-5 w-5 text-amber-600" />
                    {d.batchNumber}
                  </div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {d.mixtureCode} — {d.mixtureName}
                  </div>
                </div>
                {d.pocetTestov > 0 && (
                  <Badge
                    variant="outline"
                    className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  >
                    Opakovaný test
                  </Badge>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <span className="tabular-nums">
                  {d.outputKg ? `${zobrazQty(d.outputKg)} kg` : "—"}
                </span>
                <span>{formatDatum(d.productionDate)}</span>
                <span>{ZMENY[d.shift as Zmena] ?? d.shift}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {zmesi.length > 0 && parametre.length > 0 && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Trendy parametrov (SPC)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <TrendSelectors
              zmesi={zmesi}
              parametre={parametre}
              zvolenaZmes={zvolenaZmes}
              zvolenyParam={zvolenyParam}
            />
            {trend ? (
              <TrendChart
                body={trend.body}
                limity={trend.limity}
                parameterCode={zvolenyParamInfo?.code ?? ""}
                unit={zvolenyParamInfo?.unit ?? null}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Vyber zmes a parameter.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
