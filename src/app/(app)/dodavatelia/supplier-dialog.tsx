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
import { upravDodavatelaAction, vytvorDodavatelaAction } from "./actions";

type Dodavatel = {
  id: string;
  name: string;
  ico: string | null;
  dic: string | null;
  icDph: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
};

const POLIA = [
  { name: "name", label: "Názov *", required: true },
  { name: "ico", label: "IČO" },
  { name: "dic", label: "DIČ" },
  { name: "icDph", label: "IČ DPH" },
  { name: "address", label: "Adresa" },
  { name: "email", label: "E-mail" },
  { name: "phone", label: "Telefón" },
  { name: "note", label: "Poznámka" },
] as const;

export function SupplierDialog({
  dodavatel,
  trigger,
}: {
  dodavatel?: Dodavatel;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(formData: FormData) {
    const vstup = Object.fromEntries(
      POLIA.map(({ name }) => [name, String(formData.get(name) ?? "").trim()]),
    ) as Record<(typeof POLIA)[number]["name"], string>;

    startTransition(async () => {
      const vysledok = dodavatel
        ? await upravDodavatelaAction(dodavatel.id, vstup)
        : await vytvorDodavatelaAction(vstup);

      if (vysledok.ok) {
        toast.success(dodavatel ? "Dodávateľ upravený." : "Dodávateľ vytvorený.");
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
            {dodavatel ? "Upraviť dodávateľa" : "Nový dodávateľ"}
          </DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-3">
          {POLIA.map(({ name, label }) => (
            <div key={name} className="flex flex-col gap-1.5">
              <Label htmlFor={name}>{label}</Label>
              <Input
                id={name}
                name={name}
                defaultValue={dodavatel?.[name] ?? ""}
                required={name === "name"}
              />
            </div>
          ))}
          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? "Ukladám…" : "Uložiť"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
