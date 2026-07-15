"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { aktivujVerziuAction } from "../actions";

export function ActivateButton({
  mixtureId,
  recipeId,
  version,
}: {
  mixtureId: string;
  recipeId: string;
  version: number;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const vysledok = await aktivujVerziuAction(mixtureId, recipeId);
          if (vysledok.ok) {
            toast.success(`Verzia ${version} je teraz aktívna.`);
            router.refresh();
          } else {
            toast.error(vysledok.error);
          }
        })
      }
    >
      {pending ? "Aktivujem…" : `Aktivovať verziu ${version}`}
    </Button>
  );
}
