"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCentsToEur } from "@/lib/format";
import { useFormDraft } from "@/lib/use-form-draft";
import { pridajPracuAction } from "../actions";

type PracaRiadok = {
  id: string;
  workerName: string;
  workDate: string;
  hours: string;
  hourlyRateCents: number;
};
type Pracovnik = { id: string; fullName: string };
type Draft = { workerId: string; workDate: string; hours: string };

export function PracaSection({
  batchId,
  praca,
  pracovnici,
  productionDate,
  editable,
}: {
  batchId: string;
  praca: PracaRiadok[];
  pracovnici: Pracovnik[];
  productionDate: string;
  editable: boolean;
}) {
  const [draft, setDraft, clearDraft] = useFormDraft<Draft>(
    `bamipa:vyroba:${batchId}:praca`,
    { workerId: "", workDate: productionDate, hours: "" },
  );
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    if (!draft.workerId) return toast.error("Vyber pracovníka.");
    if (!draft.hours.trim()) return toast.error("Zadaj hodiny.");

    startTransition(async () => {
      const vysledok = await pridajPracuAction({
        batchId,
        workerId: draft.workerId,
        workDate: draft.workDate,
        hours: draft.hours,
      });
      if (vysledok.ok) {
        toast.success("Práca zapísaná.");
        clearDraft({ workerId: "", workDate: productionDate, hours: "" });
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  const pracovnikItems = Object.fromEntries(pracovnici.map((p) => [p.id, p.fullName]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Práca obsluhy</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {praca.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pracovník</TableHead>
                <TableHead>Dátum</TableHead>
                <TableHead className="text-right">Hodiny</TableHead>
                <TableHead className="text-right">Sadzba</TableHead>
                <TableHead className="text-right">Náklad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {praca.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.workerName}</TableCell>
                  <TableCell>{p.workDate}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.hours}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCentsToEur(p.hourlyRateCents)}/hod
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCentsToEur(Math.round(Number(p.hours) * p.hourlyRateCents))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {editable && (
          <div className="grid grid-cols-[1fr_9rem_7rem_auto] items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Select
                items={pracovnikItems}
                value={draft.workerId}
                onValueChange={(v) => setDraft({ ...draft, workerId: v ?? "" })}
              >
                <SelectTrigger className="h-12 w-full text-base">
                  <SelectValue placeholder="Pracovník" />
                </SelectTrigger>
                <SelectContent>
                  {pracovnici.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              type="date"
              className="h-12 text-base"
              value={draft.workDate}
              onChange={(e) => setDraft({ ...draft, workDate: e.target.value })}
            />
            <Input
              placeholder="Hodiny"
              className="h-12 text-base"
              value={draft.hours}
              onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
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
