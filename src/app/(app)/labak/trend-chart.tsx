"use client";

// M5 Labák — SPC trend parametra per zmes (jednoduchá vizualizácia, SPEC M5).
// Dataviz: jedna séria → bez legendy (titul ju pomenuje), body v poradí meraní
// (SPC konvencia: rovnomerné rozostupy podľa vzorky, nie kalendár), status farba
// bodu (v limite = good, mimo = critical) so slovným tooltipom (nie len farba),
// referenčné čiary limitov, recesívna mriežka, jedna os.
import { useMemo, useState } from "react";
import { formatDatum, zobrazQty } from "@/lib/format";

export type TrendBod = {
  value: string;
  isWithinLimits: boolean;
  sequenceNo: number;
  batchNumber: string;
  productionDate: string; // YYYY-MM-DD
};

const LINKA = "#2a78d6"; // neutrálna séria (validovaná paleta)
const OK = "#1baf7a"; // v limite (good)
const MIMO = "#d64545"; // mimo limitu (critical)

const W = 720;
const H = 260;
const M = { top: 16, right: 56, bottom: 28, left: 56 };

export function TrendChart({
  body,
  limity,
  parameterCode,
  unit,
}: {
  body: TrendBod[];
  limity: { minValue: string | null; maxValue: string | null } | null;
  parameterCode: string;
  unit: string | null;
}) {
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    bod: TrendBod;
  } | null>(null);

  const graf = useMemo(() => {
    if (body.length === 0) return null;
    const hodnoty = body.map((b) => Number(b.value));
    const min = limity?.minValue != null ? Number(limity.minValue) : null;
    const max = limity?.maxValue != null ? Number(limity.maxValue) : null;

    // Rozsah osi Y pokrýva dáta aj limity, s 12 % rezervou.
    const kandidati = [...hodnoty];
    if (min !== null) kandidati.push(min);
    if (max !== null) kandidati.push(max);
    let dolna = Math.min(...kandidati);
    let horna = Math.max(...kandidati);
    if (dolna === horna) {
      dolna -= 1;
      horna += 1;
    }
    const rezerva = (horna - dolna) * 0.12;
    const yMin = dolna - rezerva;
    const yMax = horna + rezerva;

    const n = body.length;
    const x = (i: number) =>
      n === 1
        ? (M.left + W - M.right) / 2
        : M.left + (i / (n - 1)) * (W - M.left - M.right);
    const y = (v: number) =>
      H - M.bottom - ((v - yMin) / (yMax - yMin)) * (H - M.top - M.bottom);

    const body2 = body.map((b, i) => ({
      px: x(i),
      py: y(Number(b.value)),
      bod: b,
    }));
    const d = body2
      .map((p, i) => (i === 0 ? `M ${p.px} ${p.py}` : `L ${p.px} ${p.py}`))
      .join(" ");

    const krok = (yMax - yMin) / 4;
    const yTicks = [0, 1, 2, 3, 4].map((i) => yMin + i * krok);

    return { body2, d, y, yTicks, min, max };
  }, [body, limity]);

  if (!graf) {
    return (
      <p className="text-sm text-muted-foreground">
        Zatiaľ žiadne merania — trend sa zobrazí po prvom meraní tejto zmesi.
      </p>
    );
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Trend parametra ${parameterCode} v čase`}
      >
        {/* recesívna mriežka + os Y */}
        {graf.yTicks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={graf.y(t)}
              y2={graf.y(t)}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={M.left - 8}
              y={graf.y(t) + 4}
              textAnchor="end"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {zobrazQty(t.toFixed(3))}
            </text>
          </g>
        ))}

        {/* referenčné čiary limitov */}
        {graf.min !== null && (
          <g>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={graf.y(graf.min)}
              y2={graf.y(graf.min)}
              stroke={MIMO}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              strokeOpacity={0.7}
            />
            <text
              x={W - M.right + 4}
              y={graf.y(graf.min) + 4}
              className="fill-muted-foreground"
              fontSize={10}
            >
              min
            </text>
          </g>
        )}
        {graf.max !== null && (
          <g>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={graf.y(graf.max)}
              y2={graf.y(graf.max)}
              stroke={MIMO}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              strokeOpacity={0.7}
            />
            <text
              x={W - M.right + 4}
              y={graf.y(graf.max) + 4}
              className="fill-muted-foreground"
              fontSize={10}
            >
              max
            </text>
          </g>
        )}

        {/* os X: prvý a posledný dátum */}
        <text x={M.left} y={H - 8} className="fill-muted-foreground" fontSize={11}>
          {formatDatum(body[0].productionDate)}
        </text>
        {body.length > 1 && (
          <text
            x={W - M.right}
            y={H - 8}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize={11}
          >
            {formatDatum(body[body.length - 1].productionDate)}
          </text>
        )}

        {/* spojnica meraní */}
        <path d={graf.d} fill="none" stroke={LINKA} strokeWidth={2} />

        {/* body — farba podľa stavu (status), hit zóna väčšia než marker */}
        {graf.body2.map((p, i) => (
          <g key={`${p.bod.batchNumber}-${p.bod.sequenceNo}-${i}`}>
            <circle
              cx={p.px}
              cy={p.py}
              r={5}
              fill={p.bod.isWithinLimits ? OK : MIMO}
              stroke="var(--background)"
              strokeWidth={2}
            />
            <circle
              cx={p.px}
              cy={p.py}
              r={14}
              fill="transparent"
              onMouseEnter={() => setHover({ x: p.px, y: p.py, bod: p.bod })}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
          style={{
            left: `${Math.min(Math.max((hover.x / W) * 100, 12), 82)}%`,
            top: `${Math.max((hover.y / H) * 100, 22)}%`,
            transform: "translate(-50%, -120%)",
          }}
        >
          <div className="font-medium">
            {hover.bod.batchNumber} · meranie #{hover.bod.sequenceNo}
          </div>
          <div className="text-muted-foreground">
            {formatDatum(hover.bod.productionDate)}
          </div>
          <div className="tabular-nums">
            {zobrazQty(hover.bod.value)}
            {unit && ` ${unit}`} ·{" "}
            <span className={hover.bod.isWithinLimits ? "text-emerald-600" : "text-red-600"}>
              {hover.bod.isWithinLimits ? "v limite" : "mimo"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
