"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCentsToEur, formatMesiac } from "@/lib/format";
import { uzavriMesiacAction } from "./actions";

export function CloseMonthButton({
  period,
  fakturyCents,
  korekcieCents,
  rozpracovanePocet,
}: {
  period: string;
  fakturyCents: number;
  korekcieCents: number;
  rozpracovanePocet: number;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    const rezie = formatCentsToEur(fakturyCents + korekcieCents);
    if (
      !window.confirm(
        `Uzavrieť mesiac ${formatMesiac(period)}? Réžie mesiaca ${rezie} sa alokujú podľa D2 kľúčov a doklady mesiaca sa uzamknú. Otvoriť ho potom môže len admin.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const vysledok = await uzavriMesiacAction(period);
      if (vysledok.ok) {
        toast.success(`Mesiac ${formatMesiac(period)} uzavretý.`);
        router.push(`/kalkulacie/${period.slice(0, 7)}`);
        router.refresh();
      } else {
        toast.error(vysledok.error ?? "Neznáma chyba.");
      }
    });
  }

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={onClick}
      title={
        rozpracovanePocet > 0
          ? `Pozor: ${rozpracovanePocet} rozpracovaných dávok bez vyrobených kg — uzávierka ich odmietne.`
          : undefined
      }
    >
      {pending ? "Uzatváram…" : "Uzavrieť"}
    </Button>
  );
}
