"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  dokonciPrikazAction,
  otvorPrikazAction,
  zrusPrikazAction,
} from "../actions";

export function OrderActions({
  workOrderId,
  status,
  maVyrobu,
}: {
  workOrderId: string;
  status: string;
  maVyrobu: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function spusti(
    akcia: (id: string) => Promise<{ ok: boolean; error?: string }>,
    potvrdenie: string,
    uspech: string,
  ) {
    if (!window.confirm(potvrdenie)) return;
    startTransition(async () => {
      const vysledok = await akcia(workOrderId);
      if (vysledok.ok) {
        toast.success(uspech);
        router.refresh();
      } else {
        toast.error(vysledok.error ?? "Neznáma chyba.");
      }
    });
  }

  if (status === "nova" && !maVyrobu) {
    return (
      <Button
        variant="outline"
        size="lg"
        disabled={pending}
        onClick={() =>
          spusti(zrusPrikazAction, "Zrušiť výrobný príkaz?", "Príkaz zrušený.")
        }
      >
        Zrušiť príkaz
      </Button>
    );
  }
  if (status === "vo_vyrobe") {
    return (
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          spusti(
            dokonciPrikazAction,
            "Dokončiť výrobný príkaz? Záznamy sa uzamknú.",
            "Príkaz dokončený.",
          )
        }
      >
        Dokončiť príkaz
      </Button>
    );
  }
  if (status === "dokoncena") {
    return (
      <Button
        variant="outline"
        size="lg"
        disabled={pending}
        onClick={() =>
          spusti(
            otvorPrikazAction,
            "Znovu otvoriť príkaz na opravy?",
            "Príkaz znovu otvorený.",
          )
        }
      >
        Znovu otvoriť
      </Button>
    );
  }
  return null;
}
