"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useFormDraft } from "@/lib/use-form-draft";
import { aktualizujCasyAction } from "../actions";

export function CasySection({
  batchId,
  workMinutes,
  editable,
}: {
  batchId: string;
  workMinutes: number | null;
  editable: boolean;
}) {
  const [hodnota, setHodnota, clearHodnota] = useFormDraft(
    `bamipa:vyroba:${batchId}:casy`,
    workMinutes ? String(workMinutes) : "",
  );
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    if (!hodnota.trim()) return toast.error("Zadaj čas v minútach.");
    startTransition(async () => {
      const vysledok = await aktualizujCasyAction({ batchId, workMinutes: Number(hodnota) });
      if (vysledok.ok) {
        toast.success("Čas zapísaný.");
        clearHodnota(hodnota);
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Čas miešania (minúty)</CardTitle>
      </CardHeader>
      <CardContent>
        {editable ? (
          <div className="flex items-end gap-2">
            <Input
              className="h-12 w-32 text-base"
              placeholder="napr. 45"
              value={hodnota}
              onChange={(e) => setHodnota(e.target.value)}
            />
            <Button size="lg" className="h-12" disabled={pending} onClick={onSubmit}>
              {pending ? "…" : "Uložiť"}
            </Button>
          </div>
        ) : (
          <p className="tabular-nums">{workMinutes ?? "—"} min</p>
        )}
      </CardContent>
    </Card>
  );
}
