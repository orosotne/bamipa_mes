import { FileInput, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
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
import { KATEGORIE_MATERIALOV } from "@/lib/enums";
import { formatPriceToEurPerUnit, zobrazQty } from "@/lib/format";
import { listMaterials } from "@/server/materials/service";
import { listSuppliers } from "@/server/suppliers/service";
import { stavSkladu } from "@/server/warehouse/queries";
import { cn } from "@/lib/utils";
import { DeleteMaterialButton } from "./delete-material-button";
import { MaterialDialog } from "./material-dialog";

export const dynamic = "force-dynamic";

export default async function SkladPage() {
  const [stav, materialy, dodavatelia] = await Promise.all([
    stavSkladu(db),
    listMaterials(db),
    listSuppliers(db),
  ]);
  const materialyMap = new Map(materialy.map((m) => [m.id, m]));
  const dodavateliaProps = dodavatelia.map((d) => ({ id: d.id, name: d.name }));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sklad materiálov</h1>
          <p className="text-sm text-muted-foreground">
            Karty materiálov, šarže vo FIFO poradí a cenová história.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/sklad/prijemky" />}
          >
            <FileInput className="h-4 w-4" /> Príjemky
          </Button>
          <MaterialDialog
            dodavatelia={dodavateliaProps}
            trigger={
              <Button>
                <Plus className="h-4 w-4" /> Nový materiál
              </Button>
            }
          />
        </div>
      </div>

      {stav.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Zatiaľ žiadne materiály — začni tlačidlom „Nový materiál“.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kód</TableHead>
                <TableHead>Názov</TableHead>
                <TableHead>Kategória</TableHead>
                <TableHead className="text-right">Zostatok</TableHead>
                <TableHead className="text-right">Min. zásoba</TableHead>
                <TableHead className="text-right">Posledná cena</TableHead>
                <TableHead className="w-24 text-right">Akcie</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stav.map((r) => (
                <TableRow
                  key={r.id}
                  className={cn(r.podMinimom && "bg-red-50 dark:bg-red-950/30")}
                >
                  <TableCell>
                    <Link
                      href={`/sklad/${r.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {r.code}
                    </Link>
                  </TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{KATEGORIE_MATERIALOV[r.category]}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      r.podMinimom && "font-semibold text-red-600",
                    )}
                  >
                    {r.podMinimom && (
                      <TriangleAlert className="mr-1 inline h-4 w-4" />
                    )}
                    {zobrazQty(r.zostatok)} {r.unit}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.minStockQty ? `${zobrazQty(r.minStockQty)} ${r.unit}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.poslednaCena
                      ? `${formatPriceToEurPerUnit(r.poslednaCena)}/${r.unit}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <MaterialDialog
                        material={materialyMap.get(r.id)}
                        dodavatelia={dodavateliaProps}
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label="Upraviť">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <DeleteMaterialButton id={r.id} nazov={r.name}>
                        <Trash2 className="h-4 w-4" />
                      </DeleteMaterialButton>
                    </div>
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
