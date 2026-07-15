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
import { ulozZmesAction } from "./actions";

type Zmes = { id: string; code: string; name: string; note: string | null };

export function MixtureDialog({
  zmes,
  trigger,
}: {
  zmes?: Zmes;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const vysledok = await ulozZmesAction(zmes?.id ?? null, {
        code: String(formData.get("code") ?? ""),
        name: String(formData.get("name") ?? ""),
        note: String(formData.get("note") ?? ""),
      });
      if (vysledok.ok) {
        toast.success(zmes ? "Zmes upravená." : "Zmes vytvorená.");
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
          <DialogTitle>{zmes ? "Upraviť zmes" : "Nová zmes"}</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Kód zmesi *</Label>
            <Input id="code" name="code" defaultValue={zmes?.code ?? ""} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Názov *</Label>
            <Input id="name" name="name" defaultValue={zmes?.name ?? ""} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Poznámka</Label>
            <Input id="note" name="note" defaultValue={zmes?.note ?? ""} />
          </div>
          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? "Ukladám…" : "Uložiť"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
