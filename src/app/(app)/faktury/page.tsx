import { FileDown, Plus } from "lucide-react";
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
import { formatCentsToEur, formatDatum } from "@/lib/format";
import { zoznamFaktur, type FilterFaktur } from "@/server/invoices/service";
import { dnesnyDatum } from "@/server/session";
import { cn } from "@/lib/utils";
import { MrpExportDialog } from "./mrp-export-dialog";
import { StatusBadge } from "./status-badge";

export const dynamic = "force-dynamic";

const FILTRE: { key: string; label: string; filter: FilterFaktur }[] = [
  { key: "vsetky", label: "Všetky", filter: { typ: "vsetky" } },
  { key: "po_splatnosti", label: "Po splatnosti", filter: { typ: "po_splatnosti" } },
  { key: "7", label: "Splatné do 7 dní", filter: { typ: "splatne_do", dni: 7 } },
  { key: "14", label: "Splatné do 14 dní", filter: { typ: "splatne_do", dni: 14 } },
  { key: "30", label: "Splatné do 30 dní", filter: { typ: "splatne_do", dni: 30 } },
];

export default async function FakturyPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: filterKey = "vsetky" } = await searchParams;
  const aktivny = FILTRE.find((f) => f.key === filterKey) ?? FILTRE[0];
  const dnes = dnesnyDatum();

  const faktury = await zoznamFaktur(db, { dnes, filter: aktivny.filter });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Došlé faktúry</h1>
          <p className="text-sm text-muted-foreground">
            Záväzky a cash-flow — každé euro vstupujúce do firmy.
          </p>
        </div>
        <div className="flex gap-2">
          <MrpExportDialog
            dnes={dnes}
            trigger={
              <Button variant="outline">
                <FileDown className="h-4 w-4" /> Export do MRP
              </Button>
            }
          />
          <Button nativeButton={false} render={<Link href="/faktury/nova" />}>
            <Plus className="h-4 w-4" /> Nová faktúra
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTRE.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={f.key === aktivny.key ? "default" : "outline"}
            nativeButton={false}
            render={
              <Link
                href={f.key === "vsetky" ? "/faktury" : `/faktury?filter=${f.key}`}
              />
            }
          >
            {f.label}
          </Button>
        ))}
      </div>

      {faktury.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          {aktivny.key === "vsetky"
            ? "Zatiaľ žiadne faktúry — začni tlačidlom „Nová faktúra“."
            : "Žiadne faktúry pre zvolený filter."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo</TableHead>
                <TableHead>Dodávateľ</TableHead>
                <TableHead>Splatnosť</TableHead>
                <TableHead className="text-right">Suma s DPH</TableHead>
                <TableHead className="text-right">Zostatok</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead className="w-12 text-center">MRP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {faktury.map((f) => {
                const poSplatnosti = f.dueDate < dnes && f.zostatokCents > 0;
                return (
                  <TableRow
                    key={f.id}
                    className={cn(poSplatnosti && "bg-red-50 dark:bg-red-950/30")}
                  >
                    <TableCell>
                      <Link
                        href={`/faktury/${f.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {f.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{f.supplierName}</TableCell>
                    <TableCell
                      className={cn(poSplatnosti && "font-semibold text-red-600")}
                    >
                      {formatDatum(f.dueDate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCentsToEur(f.totalGrossCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCentsToEur(f.zostatokCents)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge stav={f.status} />
                    </TableCell>
                    <TableCell className="text-center">
                      {f.mrpExportedAt && (
                        <span
                          title={`Exportované do MRP ${f.mrpExportedAt.toLocaleDateString(
                            "sk-SK",
                            { timeZone: "Europe/Bratislava" },
                          )}`}
                        >
                          ✓
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
