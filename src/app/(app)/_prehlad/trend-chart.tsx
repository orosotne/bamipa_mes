"use client";

// Mesačný trend nákladu (M8, Q1/Q2) — line graf s markermi per séria.
// Dataviz pravidlá (vzor sklad/[id]/price-chart.tsx): validovaná kategorická
// paleta vo fixnom poradí (necykluje sa — série nad limit viditeľne ohlásené),
// 2px čiary, markery s ≥8px hit zónou, priame labely v text tokenoch (farbu
// nesie bodka), recesívna mriežka, hover tooltip, jedna os.
import { useMemo, useState } from "react";
import { formatCentsToEur, formatMesiac } from "@/lib/format";

export type TrendSeria = {
  nazov: string;
  /** body vo vzostupnom poradí mesiacov; hodnota v centoch (môže mať 2 des.). */
  body: { period: string; hodnota: number; popis: string }[];
};

const PALETA = ["#2a78d6", "#1baf7a", "#eda100", "#008300"] as const;

const W = 720;
const H = 240;
const M = { top: 16, right: 150, bottom: 28, left: 64 };

function tickLabel(cents: number): string {
  const eur = (cents / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${eur.replace(".", ",") || "0"} €`;
}

export function TrendChart({
  serie,
  ariaLabel,
}: {
  serie: TrendSeria[];
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    seria: string;
    period: string;
    hodnota: number;
    popis: string;
  } | null>(null);

  const { zobrazene, skryte, mesiace, x, y, yTicks } = useMemo(() => {
    const zobrazene = serie.slice(0, PALETA.length).map((s, i) => ({
      ...s,
      farba: PALETA[i],
    }));
    const skryte = serie.slice(PALETA.length).map((s) => s.nazov);

    // Spoločná časová os: zjednotené mesiace všetkých sérií, vzostupne.
    const mesiace = [...new Set(zobrazene.flatMap((s) => s.body.map((b) => b.period)))].sort();
    const hodnoty = zobrazene.flatMap((s) => s.body.map((b) => b.hodnota));
    const maxY = Math.max(...hodnoty, 1) * 1.15;

    const x = (period: string) => {
      const i = mesiace.indexOf(period);
      return mesiace.length <= 1
        ? (M.left + W - M.right) / 2
        : M.left + (i / (mesiace.length - 1)) * (W - M.left - M.right);
    };
    const y = (c: number) => H - M.bottom - (c / maxY) * (H - M.top - M.bottom);
    const krok = maxY / 4;
    const yTicks = [1, 2, 3, 4].map((i) => i * krok);

    return { zobrazene, skryte, mesiace, x, y, yTicks };
  }, [serie]);

  if (serie.length === 0 || mesiace.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Zatiaľ žiadny uzavretý mesiac — plný náklad vzniká mesačnou uzávierkou
        v Kalkuláciách.
      </p>
    );
  }

  // Koncové labely sérií s blízkymi hodnotami sa prekrývajú — rozostúp ich
  // zhora nadol s minimálnou medzerou (bodka pri texte drží identitu farbou).
  const labelY = new Map<string, number>();
  {
    const polozky = zobrazene
      .map((s) => ({ nazov: s.nazov, y: y(s.body[s.body.length - 1].hodnota) }))
      .sort((a, b) => a.y - b.y);
    for (let k = 0; k < polozky.length; k++) {
      if (k > 0 && polozky[k].y - polozky[k - 1].y < 14) {
        polozky[k].y = polozky[k - 1].y + 14;
      }
      labelY.set(polozky[k].nazov, polozky[k].y);
    }
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(t)}
              y2={y(t)}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={M.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {tickLabel(t)}
            </text>
          </g>
        ))}
        <text x={M.left} y={H - 8} className="fill-muted-foreground" fontSize={11}>
          {formatMesiac(mesiace[0])}
        </text>
        {mesiace.length > 1 && (
          <text
            x={W - M.right}
            y={H - 8}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize={11}
          >
            {formatMesiac(mesiace[mesiace.length - 1])}
          </text>
        )}

        {zobrazene.map((s) => {
          const pts = s.body.map((b) => ({
            px: x(b.period),
            py: y(b.hodnota),
            b,
          }));
          const d = pts
            .map((p, i) => `${i === 0 ? "M" : "L"} ${p.px} ${p.py}`)
            .join(" ");
          const posledny = pts[pts.length - 1];
          return (
            <g key={s.nazov}>
              <path d={d} fill="none" stroke={s.farba} strokeWidth={2} />
              {pts.map((p) => (
                <g key={p.b.period}>
                  <circle
                    cx={p.px}
                    cy={p.py}
                    r={4}
                    fill={s.farba}
                    stroke="var(--background)"
                    strokeWidth={2}
                  />
                  <circle
                    cx={p.px}
                    cy={p.py}
                    r={12}
                    fill="transparent"
                    onMouseEnter={() =>
                      setHover({
                        x: p.px,
                        y: p.py,
                        seria: s.nazov,
                        period: p.b.period,
                        hodnota: p.b.hodnota,
                        popis: p.b.popis,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              ))}
              {/* priamy label na konci série: farebná bodka + text v text tokene */}
              <circle
                cx={W - M.right + 10}
                cy={labelY.get(s.nazov) ?? posledny.py}
                r={4}
                fill={s.farba}
              />
              <text
                x={W - M.right + 18}
                y={(labelY.get(s.nazov) ?? posledny.py) + 4}
                className="fill-foreground"
                fontSize={11}
              >
                {s.nazov}
              </text>
            </g>
          );
        })}
      </svg>

      {skryte.length > 0 && (
        <p className="mt-2 text-xs font-medium text-amber-600">
          ⚠ Graf zobrazuje prvé {PALETA.length} série — ďalšie ({skryte.join(", ")})
          nájdeš v exporte CSV.
        </p>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
          style={{
            left: `${Math.min(Math.max((hover.x / W) * 100, 12), 82)}%`,
            top: `${Math.max((hover.y / H) * 100, 22)}%`,
            transform: "translate(-50%, -120%)",
          }}
        >
          <div className="font-medium">{hover.seria}</div>
          <div className="text-muted-foreground">{formatMesiac(hover.period)}</div>
          <div className="tabular-nums">
            {formatCentsToEur(Math.round(hover.hodnota))} {hover.popis}
          </div>
        </div>
      )}
    </div>
  );
}
