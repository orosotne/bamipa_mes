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
import { useFormDraft } from "@/lib/use-form-draft";
import { odovzdajNaLabakAction } from "../actions";

export function SubmitToLabDialog({
  batchId,
  label = "Odovzdať na labák",
}: {
  batchId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [outputKg, setOutputKg, clearOutputKg] = useFormDraft(
    `bamipa:vyroba:${batchId}:outputKg`,
    "",
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit() {
    if (!outputKg.trim()) return toast.error("Zadaj skutočnú výrobu (kg).");
    startTransition(async () => {
      const vysledok = await odovzdajNaLabakAction({ batchId, outputKg });
      if (vysledok.ok) {
        toast.success("Dávka odovzdaná na labák.");
        clearOutputKg("");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="lg" className="h-16 w-full text-lg">
            {label}
          </Button>
        }
      />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Odovzdanie dávky na labák</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="outputKg">Skutočná výroba (kg) *</Label>
            <Input
              id="outputKg"
              className="h-12 text-base"
              placeholder="napr. 98,5"
              value={outputKg}
              onChange={(e) => setOutputKg(e.target.value)}
              autoFocus
            />
          </div>
          <Button size="lg" className="h-14 text-base" disabled={pending} onClick={onSubmit}>
            {pending ? "Odovzdávam…" : "Potvrdiť a odovzdať"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
