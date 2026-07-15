"use client";

// Pretoky / orez (D5): hmotnosť odpadu per príkaz — 100 % strata, KPI
// odpadovosti. Vzor prestoje-section z /vyroba.
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDatum, zobrazQty } from "@/lib/format";
import { useFormDraft } from "@/lib/use-form-draft";
import { zapisOrezAction, zmazOrezAction } from "../actions";

type OrezRiadok = {
  id: string;
  qtyKg: string;
  recordDate: string;
  note: string | null;
};
type Draft = { qtyKg: string; recordDate: string; note: string };

export function OrezSection({
  workOrderId,
  orezy,
  dnes,
  editable,
}: {
  workOrderId: string;
  orezy: OrezRiadok[];
  dnes: string;
  editable: boolean;
}) {
  const [draft, setDraft, clearDraft] = useFormDraft<Draft>(
    `bamipa:lisovna:${workOrderId}:orez`,
    { qtyKg: "", recordDate: dnes, note: "" },
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit() {
    if (!draft.qtyKg.trim()) return toast.error("Zadaj hmotnosť odpadu.");

    startTransition(async () => {
      const vysledok = await zapisOrezAction({
        workOrderId,
        qtyKg: draft.qtyKg,
        recordDate: draft.recordDate,
        note: draft.note,
      });
      if (vysledok.ok) {
        toast.success("Orez zapísaný.");
        clearDraft({ qtyKg: "", recordDate: draft.recordDate, note: "" });
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  function onZmaz(riadok: OrezRiadok) {
    if (
      !window.confirm(
        `Zmazať orez ${zobrazQty(riadok.qtyKg)} kg z ${formatDatum(riadok.recordDate)}?`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const vysledok = await zmazOrezAction({ id: riadok.id, workOrderId });
      if (vysledok.ok) {
        toast.success("Orez zmazaný.");
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orez / pretoky (odpad)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {orezy.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dátum</TableHead>
                <TableHead className="text-right">Hmotnosť (kg)</TableHead>
                <TableHead>Poznámka</TableHead>
                {editable && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {orezy.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>{formatDatum(o.recordDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {zobrazQty(o.qtyKg)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {o.note ?? "—"}
                  </TableCell>
                  {editable && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Zmazať orez"
                        disabled={pending}
                        onClick={() => onZmaz(o)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {editable && (
          <div className="grid grid-cols-[7rem_9rem_1fr_auto] items-end gap-2">
            <Input
              placeholder="Kg"
              inputMode="decimal"
              className="h-12 text-base"
              value={draft.qtyKg}
              onChange={(e) => setDraft({ ...draft, qtyKg: e.target.value })}
            />
            <Input
              type="date"
              className="h-12 text-base"
              value={draft.recordDate}
              onChange={(e) =>
                setDraft({ ...draft, recordDate: e.target.value })
              }
            />
            <Input
              placeholder="Poznámka"
              className="h-12 text-base"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
            <Button size="lg" className="h-12" disabled={pending} onClick={onSubmit}>
              {pending ? "…" : "Pridať"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
