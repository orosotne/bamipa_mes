import { BadgePercent, Settings2 } from "lucide-react";
import Link from "next/link";
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
import { formatCentsToEur, formatMesiac } from "@/lib/format";
import { prehladMesiacov } from "@/server/calc/queries";
import { getCurrentUser } from "@/server/session";
import { CloseMonthButton } from "./close-month-button";

export const dynamic = "force-dynamic";

export default async function KalkulaciePage() {
  const user = await getCurrentUser(db);
  const mesiace = await prehladMesiacov(db);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Kalkulácie — mesačné uzávierky
          </h1>
          <p className="text-sm text-muted-foreground">
            Alokácia réžií podľa D2 kľúčov, plný náklad na kg a na pár, marže.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href="/kalkulacie/marze" />}
          >
            <BadgePercent className="h-4 w-4" /> Marže artiklov
          </Button>
          {user.role === "admin" && (
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={<Link href="/kalkulacie/nastavenia" />}
            >
              <Settings2 className="h-4 w-4" /> Nastavenia
            </Button>
          )}
        </div>
      </div>

      {mesiace.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Zatiaľ žiadne nákladové doklady — uzávierky sa objavia s prvými
          faktúrami a výrobou.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mesiac</TableHead>
                <TableHead className="text-right">Réžie z faktúr</TableHead>
                <TableHead className="text-right">Korekčné položky</TableHead>
                <TableHead className="text-right">Dávky</TableHead>
                <TableHead className="text-right">Cykly lisov</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead className="text-right">Akcia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mesiace.map((m) => (
                <TableRow key={m.period}>
                  <TableCell className="font-medium">
                    {m.uzavrety ? (
                      <Link
                        href={`/kalkulacie/${m.period.slice(0, 7)}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {formatMesiac(m.period)}
                      </Link>
                    ) : (
                      formatMesiac(m.period)
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCentsToEur(m.fakturyCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.korekcieCents === 0
                      ? "—"
                      : formatCentsToEur(m.korekcieCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.davkyPocet}
                    {m.rozpracovanePocet > 0 && (
                      <span className="ml-1 text-amber-600">
                        (+{m.rozpracovanePocet} rozprac.)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.cyklyPocet}
                  </TableCell>
                  <TableCell>
                    {m.uzavrety ? (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        Uzavretý
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Otvorený
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {m.uzavrety ? (
                      <Button
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={
                          <Link href={`/kalkulacie/${m.period.slice(0, 7)}`} />
                        }
                      >
                        Detail
                      </Button>
                    ) : (
                      <CloseMonthButton
                        period={m.period}
                        fakturyCents={m.fakturyCents}
                        korekcieCents={m.korekcieCents}
                        rozpracovanePocet={m.rozpracovanePocet}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
