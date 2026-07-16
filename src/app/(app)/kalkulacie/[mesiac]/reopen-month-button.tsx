"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatMesiac } from "@/lib/format";
import { otvorMesiacAction } from "../actions";

export function ReopenMonthButton({ period }: { period: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (
      !window.confirm(
        `Otvoriť mesiac ${formatMesiac(period)}? Sadzby a alokácie prestanú platiť a doklady mesiaca sa odomknú — po opravách treba mesiac uzavrieť znova.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const vysledok = await otvorMesiacAction(period);
      if (vysledok.ok) {
        toast.success(`Mesiac ${formatMesiac(period)} otvorený.`);
        router.push("/kalkulacie");
        router.refresh();
      } else {
        toast.error(vysledok.error ?? "Neznáma chyba.");
      }
    });
  }

  return (
    <Button variant="destructive" size="lg" disabled={pending} onClick={onClick}>
      {pending ? "Otváram…" : "Otvoriť mesiac (reopen)"}
    </Button>
  );
}
