// Traceability report pre odberateľa (F3, SPEC §5 M6): tlačová zostava k DL —
// externý dokument BEZ cien a bez množstiev surovín (know-how receptúry).
// A4 tlač priamo z prehliadača (@page v globals.css, app shell má print:hidden).
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { VERDIKTY, ZMENY, type Zmena } from "@/lib/enums";
import { formatDatum, zobrazQty } from "@/lib/format";
import { traceabilitaDodacieho } from "@/server/press/queries";
import { dnesnyDatum } from "@/server/session";
import { TlacButton } from "./tlac-button";

export const dynamic = "force-dynamic";

/** timestamptz → dátum v Europe/Bratislava (vzor detail príkazu). */
function datumZCasu(d: Date): string {
  return formatDatum(
    d.toLocaleDateString("en-CA", { timeZone: "Europe/Bratislava" }),
  );
}

function zobrazLimit(min: string | null, max: string | null): string {
  if (min !== null && max !== null) return `${zobrazQty(min)} – ${zobrazQty(max)}`;
  if (min !== null) return `≥ ${zobrazQty(min)}`;
  if (max !== null) return `≤ ${zobrazQty(max)}`;
  return "—";
}

const th = "border border-foreground/30 px-2 py-1 text-left font-medium";
const td = "border border-foreground/30 px-2 py-1";

export default async function TraceabilitaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let report: Awaited<ReturnType<typeof traceabilitaDodacieho>>;
  try {
    report = await traceabilitaDodacieho(db, id);
  } catch {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 print:max-w-none print:gap-4">
      <div className="flex items-center gap-4 print:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Späť na dodací list"
          nativeButton={false}
          render={<Link href={`/lisovna/expedicia/${report.dodaci.id}`} />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="flex-1 text-2xl font-semibold tracking-tight">
          Traceability report — {report.dodaci.shipmentNumber}
        </h1>
        <TlacButton />
      </div>

      {/* Hlavička dokumentu */}
      <header className="border-b pb-4">
        <div className="text-xl font-semibold tracking-tight">BAMIPA</div>
        <div className="text-sm text-muted-foreground print:text-foreground">
          Traceability report k dodaciemu listu
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground print:text-foreground/70">
              Dodací list
            </dt>
            <dd className="font-medium">{report.dodaci.shipmentNumber}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground print:text-foreground/70">
              Dátum expedície
            </dt>
            <dd className="font-medium">{formatDatum(report.dodaci.shipDate)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground print:text-foreground/70">
              Odberateľ
            </dt>
            <dd className="font-medium">{report.dodaci.customer}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground print:text-foreground/70">
              Vygenerované
            </dt>
            <dd className="font-medium">{formatDatum(dnesnyDatum())}</dd>
          </div>
        </dl>
      </header>

      {/* Položky a výroba */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Položky a výroba</h2>
        {report.polozky.map((p) => (
          <div key={p.orderNumber} className="break-inside-avoid">
            <div className="mb-1 text-sm">
              <span className="font-medium">
                {p.artikelCode} — {p.artikelName}
              </span>{" "}
              · Výrobný príkaz {p.orderNumber} · Páry:{" "}
              <span className="tabular-nums">{p.qtyPairs}</span>
            </div>
            {p.vykony.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Bez zaevidovaných výkonov lisovne.
              </p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>Lis</th>
                    <th className={th}>Dátum</th>
                    <th className={th}>Zmena</th>
                    <th className={`${th} text-right`}>Vyrobené páry</th>
                    <th className={th}>Dávka zmesi</th>
                  </tr>
                </thead>
                <tbody>
                  {p.vykony.map((v, i) => (
                    <tr key={i}>
                      <td className={td}>
                        {v.machineCode} — {v.machineName}
                      </td>
                      <td className={td}>{formatDatum(v.runDate)}</td>
                      <td className={td}>{ZMENY[v.shift as Zmena] ?? v.shift}</td>
                      <td className={`${td} text-right tabular-nums`}>
                        {v.pairsProduced}
                      </td>
                      <td className={td}>{v.batchNumber}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </section>

      {/* Dávky zmesí a kontrola kvality */}
      <section className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold">
          Dávky zmesí a kontrola kvality
        </h2>
        {report.davky.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Bez použitých dávok zmesí.
          </p>
        )}
        {report.davky.map((d) => (
          <div key={d.batchNumber} className="break-inside-avoid">
            <div className="mb-1 text-sm">
              <span className="font-medium">Dávka {d.batchNumber}</span> · Zmes:{" "}
              {d.mixtureCode} — {d.mixtureName} · Dátum výroby:{" "}
              {formatDatum(d.productionDate)}
            </div>
            <div className="mb-2 text-sm">
              Verdikt labáku:{" "}
              {d.verdikt ? (
                <>
                  <span className="font-medium">
                    {VERDIKTY[d.verdikt.verdict]}
                  </span>{" "}
                  · {datumZCasu(d.verdikt.verdictAt)} · Podpísal:{" "}
                  {d.verdikt.verdictByName ?? "—"}
                </>
              ) : (
                "—"
              )}
            </div>

            <table className="mb-2 w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>Parameter</th>
                  <th className={`${th} text-right`}>Hodnota</th>
                  <th className={th}>Jednotka</th>
                  <th className={`${th} text-right`}>Limit</th>
                  <th className={th}>V limite</th>
                </tr>
              </thead>
              <tbody>
                {d.merania.map((m) => (
                  <tr key={m.parameterCode}>
                    <td className={td}>
                      {m.parameterCode} — {m.parameterName}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {zobrazQty(m.value)}
                    </td>
                    <td className={td}>{m.unit ?? "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {zobrazLimit(m.minLimit, m.maxLimit)}
                    </td>
                    <td className={td}>{m.isWithinLimits ? "Áno" : "Nie"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>Materiál</th>
                  <th className={th}>Šarža dodávateľa</th>
                  <th className={th}>Príjemka</th>
                  <th className={th}>Dodávateľ</th>
                  <th className={th}>Dátum príjmu</th>
                </tr>
              </thead>
              <tbody>
                {d.sarze.length === 0 && (
                  <tr>
                    <td className={td} colSpan={5}>
                      Bez evidovanej spotreby surovín.
                    </td>
                  </tr>
                )}
                {d.sarze.map((s, i) => (
                  <tr key={i}>
                    <td className={td}>
                      {s.materialCode} — {s.materialName}
                    </td>
                    <td className={td}>{s.supplierLotCode ?? "—"}</td>
                    <td className={td}>{s.receiptNumber}</td>
                    <td className={td}>{s.supplierName ?? "—"}</td>
                    <td className={td}>{formatDatum(s.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <footer className="border-t pt-3 text-xs text-muted-foreground print:text-foreground/70">
        Traceabilita: dodávka → výrobný príkaz → dávka zmesi → šarže surovín.
        Merania voči limitom platným v čase skúšky.
      </footer>
    </div>
  );
}
