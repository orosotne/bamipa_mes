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
import { inventurnaKorekciaMaterialuAction } from "../actions";

/** Inventúrne manko per MATERIÁL — odpis zo šarží vo FIFO poradí (D1). */
export function MaterialCorrectionDialog({
  materialId,
  materialCode,
  unit,
  strediska,
  trigger,
}: {
  materialId: string;
  materialCode: string;
  unit: string;
  strediska: { id: string; name: string }[];
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [costCenterId, setCostCenterId] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const vysledok = await inventurnaKorekciaMaterialuAction({
        materialId,
        qty: String(formData.get("qty") ?? ""),
        costCenterId,
        note: String(formData.get("note") ?? ""),
      });
      if (vysledok.ok) {
        toast.success("Inventúrne manko odpísané vo FIFO poradí.");
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
          <DialogTitle>Inventúrne manko — {materialCode}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Manko sa odpíše zo šarží vo FIFO poradí (najstaršia prvá), každá za
          cenu svojej šarže. Prebytok eviduj na konkrétnej šarži.
        </p>
        <form action={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qty">Manko ({unit}) *</Label>
            <Input id="qty" name="qty" placeholder="napr. 12,5" required />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Nákladové stredisko *</Label>
            <Select
              items={Object.fromEntries(strediska.map((s) => [s.id, s.name]))}
              value={costCenterId}
              onValueChange={(v) => setCostCenterId(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Vyber stredisko" />
              </SelectTrigger>
              <SelectContent>
                {strediska.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Poznámka (napr. Inventúra 07/2026)</Label>
            <Input id="note" name="note" />
          </div>

          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? "Ukladám…" : "Odpísať manko"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
