import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { listSuppliers } from "@/server/suppliers/service";
import { DeleteSupplierButton } from "./delete-supplier-button";
import { SupplierDialog } from "./supplier-dialog";

export const dynamic = "force-dynamic";

export default async function DodavateliaPage() {
  const dodavatelia = await listSuppliers(db);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dodávatelia</h1>
          <p className="text-sm text-muted-foreground">
            Karty dodávateľov pre došlé faktúry a cenovú históriu materiálov.
          </p>
        </div>
        <SupplierDialog
          trigger={
            <Button>
              <Plus className="h-4 w-4" /> Nový dodávateľ
            </Button>
          }
        />
      </div>

      {dodavatelia.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Zatiaľ žiadni dodávatelia — začni tlačidlom „Nový dodávateľ".
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Názov</TableHead>
                <TableHead>IČO</TableHead>
                <TableHead>IČ DPH</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Telefón</TableHead>
                <TableHead className="w-24 text-right">Akcie</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dodavatelia.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>{d.ico ?? "—"}</TableCell>
                  <TableCell>{d.icDph ?? "—"}</TableCell>
                  <TableCell>{d.email ?? "—"}</TableCell>
                  <TableCell>{d.phone ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <SupplierDialog
                        dodavatel={d}
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label="Upraviť">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <DeleteSupplierButton id={d.id} nazov={d.name}>
                        <Trash2 className="h-4 w-4" />
                      </DeleteSupplierButton>
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
