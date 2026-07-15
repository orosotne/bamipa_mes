"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  KATEGORIE_MATERIALOV,
  MERNE_JEDNOTKY,
  type KategoriaMaterialu,
  type MernaJednotka,
} from "@/lib/enums";
import { ulozMaterialAction } from "./actions";

type MaterialNaUpravu = {
  id: string;
  code: string;
  name: string;
  unit: MernaJednotka;
  category: KategoriaMaterialu;
  minStockQty: string | null;
  note: string | null;
  predvoleniDodavatelia: string[];
};

export function MaterialDialog({
  material,
  dodavatelia,
  trigger,
}: {
  material?: MaterialNaUpravu;
  dodavatelia: { id: string; name: string }[];
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState<MernaJednotka>(material?.unit ?? "kg");
  const [category, setCategory] = useState<KategoriaMaterialu>(
    material?.category ?? "kaucuk",
  );
  const [supplierIds, setSupplierIds] = useState<string[]>(
    material?.predvoleniDodavatelia ?? [],
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Stav selectov/checkboxov žije nad Dialogom — pri otvorení ho resetuj
  // z props, inak prežijú neuložené zmeny z minule zavretého dialógu.
  function onOpenChange(next: boolean) {
    if (next) {
      setUnit(material?.unit ?? "kg");
      setCategory(material?.category ?? "kaucuk");
      setSupplierIds(material?.predvoleniDodavatelia ?? []);
    }
    setOpen(next);
  }

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const vysledok = await ulozMaterialAction(material?.id ?? null, {
        code: String(formData.get("code") ?? ""),
        name: String(formData.get("name") ?? ""),
        unit,
        category,
        minStockQty: String(formData.get("minStockQty") ?? ""),
        note: String(formData.get("note") ?? ""),
        supplierIds,
      });
      if (vysledok.ok) {
        toast.success(material ? "Materiál upravený." : "Materiál vytvorený.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {material ? "Upraviť materiál" : "Nový materiál"}
          </DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">Kód *</Label>
              <Input
                id="code"
                name="code"
                defaultValue={material?.code ?? ""}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Merná jednotka *</Label>
              <Select
                items={MERNE_JEDNOTKY}
                value={unit}
                onValueChange={(v) => setUnit((v ?? "kg") as MernaJednotka)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MERNE_JEDNOTKY).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Názov *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={material?.name ?? ""}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Kategória *</Label>
              <Select
                items={KATEGORIE_MATERIALOV}
                value={category}
                onValueChange={(v) =>
                  setCategory((v ?? "ine") as KategoriaMaterialu)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KATEGORIE_MATERIALOV).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="minStockQty">Min. zásoba ({unit})</Label>
              <Input
                id="minStockQty"
                name="minStockQty"
                placeholder="napr. 500"
                defaultValue={material?.minStockQty ?? ""}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Predvolení dodávatelia</Label>
            <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border p-2">
              {dodavatelia.length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  Žiadni dodávatelia — pridaj ich v sekcii Dodávatelia.
                </span>
              ) : (
                dodavatelia.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={supplierIds.includes(d.id)}
                      onChange={(e) =>
                        setSupplierIds((prev) =>
                          e.target.checked
                            ? [...prev, d.id]
                            : prev.filter((id) => id !== d.id),
                        )
                      }
                    />
                    {d.name}
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Poznámka</Label>
            <Input id="note" name="note" defaultValue={material?.note ?? ""} />
          </div>

          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? "Ukladám…" : "Uložiť"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
