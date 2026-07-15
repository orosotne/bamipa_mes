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
import { ulozStrojAction } from "./actions";

type Stroj = {
  id: string;
  code: string;
  name: string;
  costCenterId: string;
  isActive: boolean;
};

export function MachineDialog({
  stroj,
  strediska,
  trigger,
}: {
  stroj?: Stroj;
  strediska: { id: string; name: string }[];
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [costCenterId, setCostCenterId] = useState(stroj?.costCenterId ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onOpenChange(next: boolean) {
    if (next) {
      setCostCenterId(stroj?.costCenterId ?? "");
    }
    setOpen(next);
  }

  function onSubmit(formData: FormData) {
    if (!costCenterId) {
      toast.error("Vyber stredisko.");
      return;
    }
    startTransition(async () => {
      const vysledok = await ulozStrojAction(stroj?.id ?? null, {
        code: String(formData.get("code") ?? ""),
        name: String(formData.get("name") ?? ""),
        costCenterId,
        isActive: stroj ? stroj.isActive : true,
      });
      if (vysledok.ok) {
        toast.success(stroj ? "Stroj upravený." : "Stroj vytvorený.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  const strediskaItems = Object.fromEntries(strediska.map((s) => [s.id, s.name]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{stroj ? "Upraviť stroj" : "Nový stroj"}</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Kód *</Label>
            <Input id="code" name="code" defaultValue={stroj?.code ?? ""} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Názov *</Label>
            <Input id="name" name="name" defaultValue={stroj?.name ?? ""} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Stredisko *</Label>
            <Select
              items={strediskaItems}
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
          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? "Ukladám…" : "Uložiť"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
