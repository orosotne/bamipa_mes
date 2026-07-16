import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { formatDatum } from "@/lib/format";
import { marzeArtiklov } from "@/server/calc/margins";
import {
  bucketujCashflow,
  nakladNaKgMesacne,
  nakladNaParMesacne,
  nepodarky,
  plusDni,
  prestoje,
  topMaterialy,
  vyrobneKpi,
  type NakladKgBod,
  type NakladParBod,
} from "@/server/dashboard/queries";
import { zoznamFaktur } from "@/server/invoices/service";
import { domovModul, smieVidiet } from "@/server/rbac";
import { dnesnyDatum, getCurrentUser } from "@/server/session";
import { CashflowKalendar, PoSplatnostiAlert } from "./_prehlad/cashflow-kalendar";
import { ExportyCard } from "./_prehlad/exporty-card";
import { KpiDlazdice } from "./_prehlad/kpi-dlazdice";
import { MarzeTabulka } from "./_prehlad/marze-tabulka";
import { NepodarkyBary } from "./_prehlad/nepodarky-bary";
import { PrestojeBary } from "./_prehlad/prestoje-bary";
import { TopMaterialyTabulka } from "./_prehlad/top-materialy";
import { TrendChart, type TrendSeria } from "./_prehlad/trend-chart";

export const dynamic = "force-dynamic";

// M8 dashboard (SPEC §3 primárne otázky Q1–Q6). Plný obsah admin+ekonóm;
// majstri vidia výrobné KPI a prestoje (bez peňazí); laborant má domov
// v labáku — presmerovanie ako pred M8.

function serieNakladKg(body: NakladKgBod[]): TrendSeria[] {
  const mapa = new Map<string, TrendSeria>();
  for (const b of body) {
    if (!b.uzavrety || b.fullPerKg === null) continue;
    const s = mapa.get(b.mixtureCode) ?? { nazov: b.mixtureCode, body: [] };
    s.body.push({
      period: b.period,
      hodnota: Number(b.fullPerKg),
      popis: "/kg (plný náklad)",
    });
    mapa.set(b.mixtureCode, s);
  }
  return [...mapa.values()];
}

function serieNakladPar(body: NakladParBod[]): TrendSeria[] {
  const mapa = new Map<string, TrendSeria>();
  for (const b of body) {
    if (!b.kompletne || b.costPerPair === null) continue;
    const s = mapa.get(b.soleModelCode) ?? { nazov: b.soleModelCode, body: [] };
    s.body.push({
      period: b.period,
      hodnota: Number(b.costPerPair),
      popis: "/pár (plný náklad)",
    });
    mapa.set(b.soleModelCode, s);
  }
  return [...mapa.values()];
}

export default async function PrehladPage({
  searchParams,
}: {
  searchParams: Promise<{ obdobie?: string }>;
}) {
  const user = await getCurrentUser(db);
  if (!smieVidiet(user.role, "prehlad")) {
    const domov = domovModul(user.role);
    if (domov && domov !== "/") redirect(domov);
    return (
      <div className="mx-auto max-w-lg pt-24 text-center text-muted-foreground">
        Vitaj, {user.displayName}. Tvojej role zatiaľ nie je pridelený žiadny
        modul.
      </div>
    );
  }

  const { obdobie } = await searchParams;
  const dni = obdobie === "1" ? 1 : obdobie === "30" ? 30 : 7;
  const dnes = dnesnyDatum();
  const okno = { od: plusDni(dnes, -(dni - 1)), do: dnes };
  const predchadzajuce = {
    od: plusDni(dnes, -(2 * dni - 1)),
    do: plusDni(dnes, -dni),
  };
  const jeEkonom = user.role === "admin" || user.role === "ekonom";

  const [kpi, kpiPredosle, prestojeRiadky, nepodarkyRiadky] = await Promise.all([
    vyrobneKpi(db, okno),
    vyrobneKpi(db, predchadzajuce),
    prestoje(db, okno),
    nepodarky(db, okno),
  ]);

  const financie = jeEkonom
    ? await (async () => {
        const [faktury, marze, nakladyKg, nakladyPar, materialy] =
          await Promise.all([
            zoznamFaktur(db, { dnes }),
            marzeArtiklov(db),
            nakladNaKgMesacne(db),
            nakladNaParMesacne(db),
            topMaterialy(db, { od: plusDni(dnes, -364), do: dnes }),
          ]);
        return {
          buckety: bucketujCashflow(faktury, dnes),
          marze,
          nakladyKg,
          nakladyPar,
          materialy,
        };
      })()
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prehľad</h1>
          <p className="text-sm text-muted-foreground">
            Výroba, náklady a cash-flow k {formatDatum(dnes)} —{" "}
            {dni === 1
              ? "dnešný deň"
              : `obdobie posledných ${dni} dní (${formatDatum(okno.od)} – ${formatDatum(okno.do)})`}
            .
          </p>
        </div>
        <div className="flex gap-2">
          {[1, 7, 30].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={d === dni ? "default" : "outline"}
              nativeButton={false}
              render={<Link href={d === 7 ? "/" : `/?obdobie=${d}`} />}
            >
              {d === 1 ? "Dnes" : `${d} dní`}
            </Button>
          ))}
        </div>
      </div>

      {financie && (
        <PoSplatnostiAlert faktury={financie.buckety.poSplatnosti.faktury} />
      )}

      <KpiDlazdice kpi={kpi} predosle={kpiPredosle} />

      {financie && <CashflowKalendar buckety={financie.buckety} />}

      {financie && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Náklad na kg zmesi v čase</CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart
                serie={serieNakladKg(financie.nakladyKg)}
                ariaLabel="Vývoj plného nákladu na kg zmesi po mesiacoch"
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Náklad na pár podošvy v čase</CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart
                serie={serieNakladPar(financie.nakladyPar)}
                ariaLabel="Vývoj plného nákladu na pár podošvy po mesiacoch"
              />
            </CardContent>
          </Card>
        </div>
      )}

      {financie && <MarzeTabulka marze={financie.marze} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <PrestojeBary riadky={prestojeRiadky} />
        <NepodarkyBary riadky={nepodarkyRiadky} />
      </div>

      {financie && <TopMaterialyTabulka materialy={financie.materialy} />}

      {financie && <ExportyCard dni={dni} />}
    </div>
  );
}
