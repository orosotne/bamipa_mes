// Trendy nákupných cien top materiálov (SPEC M8, Q4) — tabuľka so sparkline
// per riadok (jedna farba, bez osi — trend na prvý pohľad, detail v /sklad).
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCentsToEur, formatPriceToEurPerUnit, zobrazQty } from "@/lib/format";
import type { TopMaterial } from "@/server/dashboard/queries";

const FARBA = "#2a78d6";
const W = 110;
const H = 26;

function Sparkline({ body }: { body: TopMaterial["body"] }) {
  const hodnoty = body.map((b) => Number(b.unitPrice));
  const min = Math.min(...hodnoty);
  const max = Math.max(...hodnoty);
  const y = (v: number) =>
    max === min ? H / 2 : H - 4 - ((v - min) / (max - min)) * (H - 8);
  const x = (i: number) =>
    body.length === 1 ? W / 2 : 4 + (i / (body.length - 1)) * (W - 8);
  const d = hodnoty.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label="Trend nákupnej ceny"
    >
      {body.length > 1 && <path d={d} fill="none" stroke={FARBA} strokeWidth={2} />}
      <circle
        cx={x(body.length - 1)}
        cy={y(hodnoty[hodnoty.length - 1])}
        r={3}
        fill={FARBA}
      />
    </svg>
  );
}

export function TopMaterialyTabulka({ materialy }: { materialy: TopMaterial[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nákupné ceny surovín — top {materialy.length || 10}</CardTitle>
      </CardHeader>
      <CardContent>
        {materialy.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Za posledných 12 mesiacov nie sú žiadne príjmy materiálu.
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Materiál</TableHead>
                  <TableHead className="text-right">Nákupy (12 mes.)</TableHead>
                  <TableHead className="text-right">Posledná cena</TableHead>
                  <TableHead className="text-right">Zmena</TableHead>
                  <TableHead>Trend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materialy.map((m) => (
                  <TableRow key={m.materialId}>
                    <TableCell>
                      <Link
                        href={`/sklad/${m.materialId}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {m.code} — {m.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCentsToEur(m.hodnotaCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPriceToEurPerUnit(m.poslednaCena)}/{m.unit}
                      <div className="text-xs text-muted-foreground">
                        {m.poslednyDodavatel ?? "počiatočný stav"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.zmenaPct === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        `${Number(m.zmenaPct) > 0 ? "▲ +" : Number(m.zmenaPct) < 0 ? "▼ " : ""}${zobrazQty(m.zmenaPct)} %`
                      )}
                    </TableCell>
                    <TableCell>
                      <Sparkline body={m.body} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
