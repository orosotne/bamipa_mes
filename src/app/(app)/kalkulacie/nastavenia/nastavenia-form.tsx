"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ulozNastaveniaAction } from "../actions";

export function NastaveniaForm({ valcovnaPct }: { valcovnaPct: number }) {
  const [hodnota, setHodnota] = useState(String(valcovnaPct));
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const parsed = Number(hodnota);
  const lisovna =
    Number.isInteger(parsed) && parsed >= 0 && parsed <= 100
      ? 100 - parsed
      : null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const vysledok = await ulozNastaveniaAction({ valcovnaPct: hodnota });
      if (vysledok.ok) {
        toast.success("Alokačné nastavenia uložené.");
        router.refresh();
      } else {
        toast.error(vysledok.error ?? "Neznáma chyba.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <div className="space-y-2">
        <Label htmlFor="valcovnaPct">
          Podiel valcovne na energiách (%)
        </Label>
        <Input
          id="valcovnaPct"
          inputMode="numeric"
          value={hodnota}
          onChange={(e) => setHodnota(e.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          Lisovňa automaticky: {lisovna === null ? "—" : `${lisovna} %`}. Nový
          pomer platí pre budúce uzávierky; už uzavreté mesiace sa nemenia.
        </p>
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Ukladám…" : "Uložiť pomer"}
      </Button>
    </form>
  );
}
