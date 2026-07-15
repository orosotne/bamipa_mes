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
import { inventurnaKorekciaAction } from "../actions";

export function CorrectionDialog({
  lotId,
  materialId,
  receiptNumber,
  unit,
  strediska,
  trigger,
}: {
  lotId: string;
  materialId: string;
  receiptNumber: string;
  unit: string;
  strediska: { id: string; name: string }[];
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [smer, setSmer] = useState<"manko" | "prebytok">("manko");
  const [costCenterId, setCostCenterId] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const vysledok = await inventurnaKorekciaAction({
        lotId,
        materialId,
        smer,
        qty: String(formData.get("qty") ?? ""),
        costCenterId,
        note: String(formData.get("note") ?? ""),
      });
      if (vysledok.ok) {
        toast.success("Inventúrna korekcia zaevidovaná.");
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
          <DialogTitle>Inventúrna korekcia — šarža {receiptNumber}</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={smer === "manko" ? "destructive" : "outline"}
              className="flex-1"
              onClick={() => setSmer("manko")}
            >
              Manko (−)
            </Button>
            <Button
              type="button"
              variant={smer === "prebytok" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setSmer("prebytok")}
            >
              Prebytok (+)
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qty">Množstvo ({unit}) *</Label>
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
            {pending ? "Ukladám…" : "Zaevidovať korekciu"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
