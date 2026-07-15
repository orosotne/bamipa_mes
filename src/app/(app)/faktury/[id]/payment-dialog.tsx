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
import { pridajPlatbuAction } from "../actions";

export function PaymentDialog({
  invoiceId,
  dnes,
  trigger,
}: {
  invoiceId: string;
  dnes: string;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const vysledok = await pridajPlatbuAction({
        invoiceId,
        paidAt: String(formData.get("paidAt") ?? ""),
        sumaEur: String(formData.get("sumaEur") ?? ""),
      });
      if (vysledok.ok) {
        toast.success("Platba zaevidovaná.");
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
          <DialogTitle>Pridať platbu</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="paidAt">Dátum platby *</Label>
            <Input id="paidAt" name="paidAt" type="date" defaultValue={dnes} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sumaEur">Suma (€) *</Label>
            <Input id="sumaEur" name="sumaEur" placeholder="1 234,56" required />
          </div>
          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? "Ukladám…" : "Zaevidovať platbu"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
