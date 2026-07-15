"use client";

// Cenová história materiálu (SPEC M2) — step-line graf per dodávateľ.
// Dataviz pravidlá: validovaná kategorická paleta (fixné poradie, necykluje sa),
// 2px čiary, markery ≥8px, priame labely (text v text tokenoch, farbu nesie
// bodka), recesívna mriežka, hover tooltip, jedna os.
import { useMemo, useState } from "react";
import { formatDatum, formatPriceToEurPerUnit } from "@/lib/format";

export type BodGrafu = {
  lotId: string;
  receivedAt: string; // YYYY-MM-DD
  unitPrice: string; // numeric(14,4) centy
  supplierName: string | null;
  receiptNumber: string;
};

// Validovaná kategorická paleta (dataviz reference, svetlý mód) — fixné poradie.
const PALETA = ["#2a78d6", "#1baf7a", "#eda100", "#008300"] as const;
const BEZ_DODAVATELA = "Počiatočný stav";

const W = 720;
const H = 260;
const M = { top: 16, right: 150, bottom: 28, left: 64 };

/** Tick v € — zaokrúhlené max 4 des. miesta, orezané nuly (mriežka je vodítko). */
function tickLabel(cents: number): string {
  const eur = (cents / 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `${eur.replace(".", ",")} €`;
}

function centy(price: string): number {
  return Number(price);
}

function den(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

export function PriceChart({ body }: { body: BodGrafu[] }) {
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    bod: BodGrafu;
  } | null>(null);

  const { serie, skryteSerie, x, y, yTicks } = useMemo(() => {
    const mena = (b: BodGrafu) => b.supplierName ?? BEZ_DODAVATELA;
    const nazvy = [...new Set(body.map(mena))]; // poradie prvého výskytu
    // Paleta sa necykluje (dataviz pravidlo) — série nad limit sa nezobrazia,
    // ale NIKDY nie potichu: pod grafom je upozornenie + tabuľka šarží.
    const serie = nazvy.slice(0, PALETA.length).map((nazov, i) => ({
      nazov,
      farba: PALETA[i],
      body: body.filter((b) => mena(b) === nazov),
    }));
    const skryteSerie = nazvy.slice(PALETA.length);

    const casy = body.map((b) => den(b.receivedAt));
    const ceny = body.map((b) => centy(b.unitPrice));
    const minX = Math.min(...casy);
    const maxX = Math.max(...casy);
    const minY = 0;
    const maxY = Math.max(...ceny) * 1.15;

    const x = (t: number) =>
      maxX === minX
        ? (M.left + W - M.right) / 2
        : M.left + ((t - minX) / (maxX - minX)) * (W - M.left - M.right);
    const y = (c: number) =>
      H - M.bottom - ((c - minY) / (maxY - minY)) * (H - M.top - M.bottom);

    const krok = maxY / 4;
    const yTicks = [1, 2, 3, 4].map((i) => i * krok);

    return { serie, skryteSerie, x, y, yTicks };
  }, [body]);

  if (body.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Zatiaľ žiadne príjmy — cenová história sa zobrazí po prvej príjemke.
      </p>
    );
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Vývoj nákupnej ceny v čase podľa dodávateľa"
      >
        {/* recesívna mriežka */}
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
        {/* os X: prvý a posledný dátum */}
        <text
          x={M.left}
          y={H - 8}
          className="fill-muted-foreground"
          fontSize={11}
        >
          {formatDatum(body[0].receivedAt)}
        </text>
        <text
          x={W - M.right}
          y={H - 8}
          textAnchor="end"
          className="fill-muted-foreground"
          fontSize={11}
        >
          {formatDatum(body[body.length - 1].receivedAt)}
        </text>

        {serie.map((s) => {
          const pts = s.body.map((b) => ({
            px: x(den(b.receivedAt)),
            py: y(centy(b.unitPrice)),
            bod: b,
          }));
          // step-after: cena platí, kým ju ďalší príjem nezmení
          const d = pts
            .map((p, i) =>
              i === 0
                ? `M ${p.px} ${p.py}`
                : `H ${p.px} V ${p.py}`,
            )
            .join(" ");
          const posledny = pts[pts.length - 1];
          return (
            <g key={s.nazov}>
              <path d={d} fill="none" stroke={s.farba} strokeWidth={2} />
              {pts.map((p) => (
                <g key={p.bod.lotId}>
                  <circle
                    cx={p.px}
                    cy={p.py}
                    r={4}
                    fill={s.farba}
                    stroke="var(--background)"
                    strokeWidth={2}
                  />
                  {/* neviditeľná hit zóna väčšia než marker (dataviz pravidlo) */}
                  <circle
                    cx={p.px}
                    cy={p.py}
                    r={12}
                    fill="transparent"
                    onMouseEnter={() =>
                      setHover({ x: p.px, y: p.py, bod: p.bod })
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              ))}
              {/* priamy label na konci série: farebná bodka + text v text tokene */}
              <circle
                cx={W - M.right + 10}
                cy={posledny.py}
                r={4}
                fill={s.farba}
              />
              <text
                x={W - M.right + 18}
                y={posledny.py + 4}
                className="fill-foreground"
                fontSize={11}
              >
                {s.nazov}
              </text>
            </g>
          );
        })}
      </svg>

      {skryteSerie.length > 0 && (
        <p className="mt-2 text-xs font-medium text-amber-600">
          ⚠ Graf zobrazuje prvé {PALETA.length} série — ďalší dodávatelia (
          {skryteSerie.join(", ")}) sú v tabuľke šarží nižšie.
        </p>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
          style={{
            // clamp — tooltip nesmie pretiecť mimo kontajner pri okrajoch
            left: `${Math.min(Math.max((hover.x / W) * 100, 12), 82)}%`,
            top: `${Math.max((hover.y / H) * 100, 22)}%`,
            transform: "translate(-50%, -120%)",
          }}
        >
          <div className="font-medium">
            {hover.bod.supplierName ?? BEZ_DODAVATELA}
          </div>
          <div className="text-muted-foreground">
            {formatDatum(hover.bod.receivedAt)} · {hover.bod.receiptNumber}
          </div>
          <div className="tabular-nums">
            {formatPriceToEurPerUnit(hover.bod.unitPrice)}/MJ
          </div>
        </div>
      )}
    </div>
  );
}
