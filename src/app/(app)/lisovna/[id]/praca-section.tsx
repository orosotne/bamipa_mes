"use client";

// Práca lisovne (lisovanie, orez, zapravenie, balenie) — vstup nákladu na pár
// (M7). Vzor /vyroba praca-section: snapshot sadzby robí server.
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { formatCentsToEur, formatDatum } from "@/lib/format";
import { useFormDraft } from "@/lib/use-form-draft";
import { zapisPracuAction, zmazPracuAction } from "../actions";

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
  workOrderId,
  praca,
  pracovnici,
  dnes,
  editable,
}: {
  workOrderId: string;
  praca: PracaRiadok[];
  pracovnici: Pracovnik[];
  dnes: string;
  editable: boolean;
}) {
  const [draft, setDraft, clearDraft] = useFormDraft<Draft>(
    `bamipa:lisovna:${workOrderId}:praca`,
    { workerId: "", workDate: dnes, hours: "" },
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit() {
    if (!draft.workerId) return toast.error("Vyber pracovníka.");
    if (!draft.hours.trim()) return toast.error("Zadaj hodiny.");

    startTransition(async () => {
      const vysledok = await zapisPracuAction({
        workOrderId,
        workerId: draft.workerId,
        workDate: draft.workDate,
        hours: draft.hours,
      });
      if (vysledok.ok) {
        toast.success("Práca zapísaná.");
        clearDraft({ workerId: "", workDate: draft.workDate, hours: "" });
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  function onZmaz(riadok: PracaRiadok) {
    if (
      !window.confirm(
        `Zmazať prácu ${riadok.workerName} (${riadok.hours} h, ${formatDatum(riadok.workDate)})?`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const vysledok = await zmazPracuAction({ id: riadok.id, workOrderId });
      if (vysledok.ok) {
        toast.success("Práca zmazaná.");
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  const pracovnikItems = Object.fromEntries(
    pracovnici.map((p) => [p.id, p.fullName]),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Práca lisovne</CardTitle>
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
                {editable && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {praca.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.workerName}</TableCell>
                  <TableCell>{formatDatum(p.workDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.hours}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCentsToEur(p.hourlyRateCents)}/hod
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCentsToEur(
                      Math.round(Number(p.hours) * p.hourlyRateCents),
                    )}
                  </TableCell>
                  {editable && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Zmazať prácu"
                        disabled={pending}
                        onClick={() => onZmaz(p)}
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
              inputMode="decimal"
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
