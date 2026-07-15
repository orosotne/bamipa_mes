"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { zmazStrojAction } from "./actions";

export function DeleteMachineButton({
  id,
  nazov,
  children,
}: {
  id: string;
  nazov: string;
  children: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!window.confirm(`Zmazať stroj „${nazov}"?`)) return;
    startTransition(async () => {
      const vysledok = await zmazStrojAction(id);
      if (vysledok.ok) {
        toast.success("Stroj zmazaný.");
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Zmazať ${nazov}`}
      disabled={pending}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
