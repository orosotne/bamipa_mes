import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { formatCentsToEur, formatMesiac, zobrazQty } from "@/lib/format";
import { detailUzavierky } from "@/server/calc/queries";
import { getCurrentUser } from "@/server/session";
import { ReopenMonthButton } from "./reopen-month-button";

export const dynamic = "force-dynamic";

const NAZVY_ZAKLADOV: Record<string, string> = {
  valcovna: "kg vyrobenej zmesi",
  lisovna: "lisovacie cykly",
  labak: "priame náklady dávok",
  sprava: "výrobné náklady mesiaca",
};

/** Sadzba/základ podľa D2 kľúča strediska (zobrazenie). */
function zobrazSadzbu(code: string, rate: string): string {
  const hodnota = zobrazQty(rate);
  if (code === "valcovna") return `${hodnota} c/kg`;
  if (code === "lisovna") return `${hodnota} c/cyklus`;
  return `${hodnota} %`;
}

function zobrazZaklad(code: string, basis: string): string {
  if (code === "valcovna") return `${zobrazQty(basis)} kg`;
  if (code === "lisovna") return `${zobrazQty(basis)} cyklov`;
  return formatCentsToEur(Math.round(Number(basis)));
}

function eurAleboPredbezne(cents: number | null): string {
  return cents === null ? "predbežné" : formatCentsToEur(cents);
}

export default async function UzavierkaDetailPage({
  params,
}: {
  params: Promise<{ mesiac: string }>;
}) {
  const { mesiac } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mesiac)) notFound();
  const period = `${mesiac}-01`;

  const user = await getCurrentUser(db);
  const detail = await detailUzavierky(db, period);
  if (!detail.close) notFound();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/kalkulacie"
            className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Kalkulácie
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            Uzávierka — {formatMesiac(period)}
          </h1>
          <p className="text-sm text-muted-foreground">
            Réžie mesiaca, alokačné sadzby (D2, energie D4) a kalkulácie
            dávok a príkazov. Doklady mesiaca sú uzamknuté.
          </p>
        </div>
        {user.role === "admin" && <ReopenMonthButton period={period} />}
      </div>

      <h2 className="mb-2 text-lg font-medium">Réžie a sadzby</h2>
      <div className="mb-8 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stredisko</TableHead>
              <TableHead className="text-right">Réžie (pool)</TableHead>
              <TableHead className="text-right">Základ</TableHead>
              <TableHead>Kľúč D2</TableHead>
              <TableHead className="text-right">Sadzba</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.riadky.map((r) => (
              <TableRow key={r.code}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCentsToEur(r.poolCents)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {zobrazZaklad(r.code, r.basis)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {NAZVY_ZAKLADOV[r.code] ?? r.code}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {zobrazSadzbu(r.code, r.rate)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <h2 className="mb-2 text-lg font-medium">
        Dávky mesiaca — plný náklad na kg
      </h2>
      <div className="mb-2 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dávka</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead className="text-right">kg</TableHead>
              <TableHead className="text-right">Priamy náklad</TableHead>
              <TableHead className="text-right">Réžia valcovne</TableHead>
              <TableHead className="text-right">Labák</TableHead>
              <TableHead className="text-right">Plný náklad</TableHead>
              <TableHead className="text-right">€/kg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.davky.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  V mesiaci nie sú žiadne dávky.
                </TableCell>
              </TableRow>
            ) : (
              detail.davky.map((d) => (
                <TableRow key={d.batchId}>
                  <TableCell>
                    <Link
                      href={`/vyroba/${d.batchId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {d.batchNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {d.status}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {d.outputKg ? zobrazQty(d.outputKg) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCentsToEur(d.directCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {eurAleboPredbezne(d.valcovnaCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {eurAleboPredbezne(d.labakCents)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {eurAleboPredbezne(d.fullCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {d.fullPerKg
                      ? `${formatCentsToEur(Math.round(Number(d.fullPerKg)))}/kg`
                      : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {detail.stratyZamietnuteCents > 0 && (
        <p className="mb-8 text-sm text-muted-foreground">
          Straty zamietnutých dávok mesiaca:{" "}
          <span className="font-medium text-destructive">
            {formatCentsToEur(detail.stratyZamietnuteCents)}
          </span>{" "}
          (nikdy sa nelisujú — plný náklad ostáva stratou valcovne).
        </p>
      )}

      <h2 className="mb-2 mt-8 text-lg font-medium">
        Príkazy s výkonmi v mesiaci — náklad na pár
      </h2>
      <p className="mb-2 text-sm text-muted-foreground">
        Čísla sú za CELÝ príkaz (aj keď zasahuje do viacerých mesiacov);
        „predbežné" = niektorý mesiac zložiek ešte nie je uzavretý.
      </p>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Príkaz</TableHead>
              <TableHead>Artikel</TableHead>
              <TableHead className="text-right">Dobré páry</TableHead>
              <TableHead className="text-right">Nepodarky</TableHead>
              <TableHead className="text-right">Orez kg</TableHead>
              <TableHead className="text-right">Zmes</TableHead>
              <TableHead className="text-right">Práca</TableHead>
              <TableHead className="text-right">Réžia lisovne</TableHead>
              <TableHead className="text-right">Správa</TableHead>
              <TableHead className="text-right">Spolu</TableHead>
              <TableHead className="text-right">€/pár</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.prikazy.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground">
                  V mesiaci nie sú žiadne výkony lisovne.
                </TableCell>
              </TableRow>
            ) : (
              detail.prikazy.map((p) => (
                <TableRow key={p.workOrderId}>
                  <TableCell className="font-medium">{p.orderNumber}</TableCell>
                  <TableCell>
                    {p.artikelCode} — {p.artikelName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.pairsProduced}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.defectPairs}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {zobrazQty(p.scrapKg)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {eurAleboPredbezne(p.mixtureCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCentsToEur(p.laborCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {eurAleboPredbezne(p.pressOverheadCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {eurAleboPredbezne(p.spravaCents)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {eurAleboPredbezne(p.totalCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.costPerPair
                      ? `${formatCentsToEur(Math.round(Number(p.costPerPair)))}/pár`
                      : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
