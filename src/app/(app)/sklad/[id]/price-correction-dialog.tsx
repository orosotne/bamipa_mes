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
import { formatPriceToEurPerUnit } from "@/lib/format";
import { cenovaKorekciaAction } from "../actions";

export function PriceCorrectionDialog({
  lotId,
  materialId,
  receiptNumber,
  unit,
  unitPrice,
  trigger,
}: {
  lotId: string;
  materialId: string;
  receiptNumber: string;
  unit: string;
  /** aktuálna dokladová cena šarže (DB numeric string v centoch) */
  unitPrice: string;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const vysledok = await cenovaKorekciaAction({
        lotId,
        materialId,
        novaCenaEur: String(formData.get("novaCenaEur") ?? ""),
        note: String(formData.get("note") ?? ""),
      });
      if (vysledok.ok) {
        toast.success("Cena šarže opravená.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cenová korekcia — šarža {receiptNumber}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Oprava dokladovej ceny — prepíše cenu šarže aj všetkých jej pohybov.
        </p>
        <form action={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Aktuálna cena</Label>
            <p className="text-sm tabular-nums">
              {formatPriceToEurPerUnit(unitPrice)}/{unit}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="novaCenaEur">Nová cena (€/{unit}) *</Label>
            <Input
              id="novaCenaEur"
              name="novaCenaEur"
              placeholder="napr. 1,2345"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Poznámka (napr. číslo dobropisu)</Label>
            <Input id="note" name="note" />
          </div>

          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? "Ukladám…" : "Opraviť cenu"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
