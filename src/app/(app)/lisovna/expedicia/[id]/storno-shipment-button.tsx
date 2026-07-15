"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { stornoDodaciListAction } from "../../actions";

export function StornoShipmentButton({
  id,
  cislo,
}: {
  id: string;
  cislo: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (
      !window.confirm(
        `Stornovať dodací list „${cislo}"? Páry sa vrátia na sklad hotových výrobkov.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const vysledok = await stornoDodaciListAction(id);
      if (vysledok.ok) {
        toast.success("Dodací list stornovaný.");
        router.push("/lisovna/expedicia");
        router.refresh();
      } else {
        toast.error(vysledok.error ?? "Neznáma chyba.");
      }
    });
  }

  return (
    <Button variant="destructive" size="lg" disabled={pending} onClick={onClick}>
      {pending ? "Stornujem…" : "Stornovať DL"}
    </Button>
  );
}
