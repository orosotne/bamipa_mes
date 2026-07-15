"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { schvalFakturuAction } from "../actions";

export function ApproveButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const vysledok = await schvalFakturuAction(id);
          if (vysledok.ok) {
            toast.success("Faktúra schválená.");
            router.refresh();
          } else {
            toast.error(vysledok.error);
          }
        })
      }
    >
      {pending ? "Schvaľujem…" : "Schváliť faktúru"}
    </Button>
  );
}
