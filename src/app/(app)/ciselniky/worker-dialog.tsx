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
import { ulozPracovnikaAction } from "./actions";

type Pracovnik = { id: string; fullName: string; isActive: boolean };

export function WorkerDialog({
  pracovnik,
  trigger,
}: {
  pracovnik?: Pracovnik;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const vysledok = await ulozPracovnikaAction(pracovnik?.id ?? null, {
        fullName: String(formData.get("fullName") ?? ""),
        isActive: pracovnik ? pracovnik.isActive : true,
      });
      if (vysledok.ok) {
        toast.success(pracovnik ? "Pracovník upravený." : "Pracovník vytvorený.");
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {pracovnik ? "Upraviť pracovníka" : "Nový pracovník"}
          </DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fullName">Meno *</Label>
            <Input
              id="fullName"
              name="fullName"
              defaultValue={pracovnik?.fullName ?? ""}
              required
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
