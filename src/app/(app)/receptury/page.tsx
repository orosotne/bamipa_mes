import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
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
import { zobrazQty } from "@/lib/format";
import { zoznamZmesi } from "@/server/mixtures/queries";
import { DeleteMixtureButton } from "./delete-mixture-button";
import { MixtureDialog } from "./mixture-dialog";

export const dynamic = "force-dynamic";

export default async function RecepturyPage() {
  const zmesi = await zoznamZmesi(db);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Receptúry zmesí</h1>
          <p className="text-sm text-muted-foreground">
            Verzované kusovníky (BOM) — položky v kg na štandardnú dávku.
          </p>
        </div>
        <MixtureDialog
          trigger={
            <Button>
              <Plus className="h-4 w-4" /> Nová zmes
            </Button>
          }
        />
      </div>

      {zmesi.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Zatiaľ žiadne zmesi — začni tlačidlom „Nová zmes“.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kód</TableHead>
                <TableHead>Názov</TableHead>
                <TableHead>Aktívna verzia</TableHead>
                <TableHead className="text-right">Štandardná dávka</TableHead>
                <TableHead className="text-right">Položiek</TableHead>
                <TableHead className="w-16 text-right">Akcie</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {zmesi.map((z) => (
                <TableRow key={z.id}>
                  <TableCell>
                    <Link
                      href={`/receptury/${z.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {z.code}
                    </Link>
                  </TableCell>
                  <TableCell>{z.name}</TableCell>
                  <TableCell>
                    {z.aktivnaVerzia !== null ? (
                      <Badge variant="outline">v{z.aktivnaVerzia}</Badge>
                    ) : (
                      <span className="text-muted-foreground">bez receptu</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {z.standardBatchKg ? `${zobrazQty(z.standardBatchKg)} kg` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {z.pocetPoloziek}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <MixtureDialog
                        zmes={z}
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label="Upraviť">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <DeleteMixtureButton id={z.id} nazov={z.name}>
                        <Trash2 className="h-4 w-4" />
                      </DeleteMixtureButton>
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
