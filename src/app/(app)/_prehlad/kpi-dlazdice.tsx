// KPI dlaždice (SPEC M8: denný/týždenný prehľad) — stat tiles bez grafu,
// hodnota + porovnanie s predchádzajúcim rovnako dlhým oknom v mutovanom texte.
import { Card, CardContent } from "@/components/ui/card";
import { zobrazQty } from "@/lib/format";
import type { VyrobneKpi } from "@/server/dashboard/queries";
import { formatMinuty } from "./format";

function Dlazdica({
  label,
  hodnota,
  predtym,
}: {
  label: string;
  hodnota: string;
  predtym: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
          {hodnota}
        </div>
        <div className="mt-1 text-xs text-muted-foreground tabular-nums">
          min. obdobie: {predtym}
        </div>
      </CardContent>
    </Card>
  );
}

const pct = (v: string | null) => (v === null ? "—" : `${zobrazQty(v)} %`);

export function KpiDlazdice({
  kpi,
  predosle,
}: {
  kpi: VyrobneKpi;
  predosle: VyrobneKpi;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Dlazdica
        label="Vyrobené zmesi"
        hodnota={`${zobrazQty(kpi.kgZmesi)} kg`}
        predtym={`${zobrazQty(predosle.kgZmesi)} kg`}
      />
      <Dlazdica
        label="Dobré páry"
        hodnota={String(kpi.dobreParov)}
        predtym={String(predosle.dobreParov)}
      />
      <Dlazdica
        label="Nepodarkovosť"
        hodnota={pct(kpi.nepodarkovostPct)}
        predtym={pct(predosle.nepodarkovostPct)}
      />
      <Dlazdica
        label="Odpad (orez)"
        hodnota={`${zobrazQty(kpi.odpadKg)} kg`}
        predtym={`${zobrazQty(predosle.odpadKg)} kg`}
      />
      <Dlazdica
        label="Prestoje"
        hodnota={formatMinuty(kpi.prestojeMinuty)}
        predtym={formatMinuty(predosle.prestojeMinuty)}
      />
      <Dlazdica
        label="First-pass yield labák"
        hodnota={pct(kpi.fpyPct)}
        predtym={pct(predosle.fpyPct)}
      />
    </div>
  );
}
