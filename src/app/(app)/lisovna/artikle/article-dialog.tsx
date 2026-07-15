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
import { ulozArtikelAction } from "../actions";

type Artikel = {
  id: string;
  code: string;
  name: string;
  mixtureId: string;
  mixtureKgPerPair: string;
  targetCycleSeconds: number | null;
  salePriceCents: number | null;
  isActive: boolean;
};

export function ArticleDialog({
  artikel,
  zmesi,
  trigger,
}: {
  artikel?: Artikel;
  zmesi: { id: string; code: string; name: string }[];
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [mixtureId, setMixtureId] = useState(artikel?.mixtureId ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onOpenChange(next: boolean) {
    if (next) {
      setMixtureId(artikel?.mixtureId ?? "");
    }
    setOpen(next);
  }

  function onSubmit(formData: FormData) {
    if (!mixtureId) {
      toast.error("Vyber zmes.");
      return;
    }
    startTransition(async () => {
      const vysledok = await ulozArtikelAction(artikel?.id ?? null, {
        code: String(formData.get("code") ?? ""),
        name: String(formData.get("name") ?? ""),
        mixtureId,
        mixtureKgPerPair: String(formData.get("mixtureKgPerPair") ?? ""),
        targetCycleSeconds: String(formData.get("targetCycleSeconds") ?? ""),
        salePriceEur: String(formData.get("salePriceEur") ?? ""),
        isActive: artikel ? artikel.isActive : true,
      });
      if (vysledok.ok) {
        toast.success(artikel ? "Artikel upravený." : "Artikel vytvorený.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  const zmesItems = Object.fromEntries(
    zmesi.map((z) => [z.id, `${z.code} — ${z.name}`]),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{artikel ? "Upraviť artikel" : "Nový artikel"}</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Kód *</Label>
            <Input
              id="code"
              name="code"
              defaultValue={artikel?.code ?? ""}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Model podošvy *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={artikel?.name ?? ""}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Zmes *</Label>
            <Select
              items={zmesItems}
              value={mixtureId}
              onValueChange={(v) => setMixtureId(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Vyber zmes" />
              </SelectTrigger>
              <SelectContent>
                {zmesi.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.code} — {z.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mixtureKgPerPair">Norma spotreby zmesi (kg/pár) *</Label>
            <Input
              id="mixtureKgPerPair"
              name="mixtureKgPerPair"
              inputMode="decimal"
              placeholder="napr. 0,850"
              defaultValue={artikel?.mixtureKgPerPair ?? ""}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="targetCycleSeconds">Cieľový čas cyklu (s)</Label>
            <Input
              id="targetCycleSeconds"
              name="targetCycleSeconds"
              inputMode="numeric"
              placeholder="napr. 480"
              defaultValue={artikel?.targetCycleSeconds ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="salePriceEur">Predajná cena (€/pár)</Label>
            <Input
              id="salePriceEur"
              name="salePriceEur"
              inputMode="decimal"
              placeholder="napr. 12,50"
              defaultValue={
                artikel?.salePriceCents != null
                  ? (artikel.salePriceCents / 100).toFixed(2).replace(".", ",")
                  : ""
              }
            />
          </div>
          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? "Ukladám…" : "Uložiť"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
