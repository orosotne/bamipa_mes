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
import { formatCentsToEur, formatDatum } from "@/lib/format";
import { pridajSadzbuAction } from "./actions";

type Sadzba = { id: string; hourlyRateCents: number; validFrom: string };

export function RatesDialog({
  workerId,
  workerName,
  sadzby,
  trigger,
}: {
  workerId: string;
  workerName: string;
  sadzby: Sadzba[];
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const vysledok = await pridajSadzbuAction({
        workerId,
        hodinovkaEur: String(formData.get("hodinovkaEur") ?? ""),
        validFrom: String(formData.get("validFrom") ?? ""),
      });
      if (vysledok.ok) {
        toast.success("Sadzba pridaná.");
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sadzby — {workerName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-2">
            {sadzby.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                Zatiaľ žiadna sadzba.
              </span>
            ) : (
              sadzby.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span>od {formatDatum(s.validFrom)}</span>
                  <span className="font-medium tabular-nums">
                    {formatCentsToEur(s.hourlyRateCents)}/hod
                  </span>
                </div>
              ))
            )}
          </div>
          <form action={onSubmit} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="hodinovkaEur">Sadzba (€/hod) *</Label>
                <Input
                  id="hodinovkaEur"
                  name="hodinovkaEur"
                  placeholder="napr. 8,50"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="validFrom">Platná od *</Label>
                <Input id="validFrom" name="validFrom" type="date" required />
              </div>
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Ukladám…" : "Pridať sadzbu"}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
