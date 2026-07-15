"use client";

import { X } from "lucide-react";
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
import { useFormDraft } from "@/lib/use-form-draft";
import { pridajPrestojAction, zmazPrestojAction } from "../actions";

type PrestojRiadok = { id: string; reasonName: string; minutes: number; note: string | null };
type Dovod = { id: string; name: string };
type Draft = { reasonId: string; minutes: string };

const PRAZDNY_DRAFT: Draft = { reasonId: "", minutes: "" };

export function PrestojeSection({
  batchId,
  prestoje,
  dovody,
  editable,
}: {
  batchId: string;
  prestoje: PrestojRiadok[];
  dovody: Dovod[];
  editable: boolean;
}) {
  const [draft, setDraft, clearDraft] = useFormDraft<Draft>(
    `bamipa:vyroba:${batchId}:prestoj`,
    PRAZDNY_DRAFT,
  );
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    if (!draft.reasonId) return toast.error("Vyber dôvod prestoja.");
    if (!draft.minutes.trim()) return toast.error("Zadaj trvanie prestoja (min).");

    startTransition(async () => {
      const vysledok = await pridajPrestojAction({
        batchId,
        reasonId: draft.reasonId,
        minutes: Number(draft.minutes),
      });
      if (vysledok.ok) {
        toast.success("Prestoj zapísaný.");
        clearDraft(PRAZDNY_DRAFT);
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  function zmaz(id: string) {
    startTransition(async () => {
      const vysledok = await zmazPrestojAction({ id, batchId });
      if (vysledok.ok) {
        toast.success("Prestoj zmazaný.");
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  const dovodyItems = Object.fromEntries(dovody.map((d) => [d.id, d.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prestoje</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {prestoje.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dôvod</TableHead>
                <TableHead className="text-right">Minúty</TableHead>
                {editable && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {prestoje.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.reasonName}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.minutes}</TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Zmazať prestoj"
                        disabled={pending}
                        onClick={() => zmaz(p.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {editable && (
          <div className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
            <Select
              items={dovodyItems}
              value={draft.reasonId}
              onValueChange={(v) => setDraft({ ...draft, reasonId: v ?? "" })}
            >
              <SelectTrigger className="h-12 w-full text-base">
                <SelectValue placeholder="Dôvod prestoja" />
              </SelectTrigger>
              <SelectContent>
                {dovody.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Minúty"
              className="h-12 text-base"
              value={draft.minutes}
              onChange={(e) => setDraft({ ...draft, minutes: e.target.value })}
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
