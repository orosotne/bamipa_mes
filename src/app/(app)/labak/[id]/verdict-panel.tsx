"use client";

// M5 Labák — panel verdiktu posledného merania. Tabuľka výsledkov (mimo limitu
// červeno) + veľké tlačidlá SCHVÁLIŤ / ZAMIETNUŤ. Schválenie s hodnotami mimo
// limitu si vyžiada potvrdenie; zamietnutie vyžaduje inštrukciu na úpravu dávky.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { zobrazQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { vynesVerdiktAction } from "../actions";

type Vysledok = {
  parameterId: string;
  parameterCode: string;
  parameterName: string;
  parameterUnit: string | null;
  value: string;
  minLimitSnapshot: string | null;
  maxLimitSnapshot: string | null;
  isWithinLimits: boolean;
};

function limitPopis(min: string | null, max: string | null): string {
  if (min !== null && max !== null)
    return `${zobrazQty(min)} – ${zobrazQty(max)}`;
  if (min !== null) return `≥ ${zobrazQty(min)}`;
  if (max !== null) return `≤ ${zobrazQty(max)}`;
  return "—";
}

export function VerdictPanel({
  batchId,
  labTestId,
  sequenceNo,
  vysledky,
}: {
  batchId: string;
  labTestId: string;
  sequenceNo: number;
  vysledky: Vysledok[];
}) {
  const [schvalitOpen, setSchvalitOpen] = useState(false);
  const [zamietnutOpen, setZamietnutOpen] = useState(false);
  const [instrukcia, setInstrukcia] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const pocetMimo = vysledky.filter((v) => !v.isWithinLimits).length;

  function vynes(verdict: "schvalene" | "zamietnute", instr?: string) {
    startTransition(async () => {
      const vysledok = await vynesVerdiktAction({
        labTestId,
        batchId,
        verdict,
        instrukcia: instr,
      });
      if (vysledok.ok) {
        toast.success(
          verdict === "schvalene" ? "Dávka schválená." : "Dávka zamietnutá.",
        );
        setSchvalitOpen(false);
        setZamietnutOpen(false);
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  function onSchvalit() {
    if (pocetMimo > 0) setSchvalitOpen(true);
    else vynes("schvalene");
  }

  function onZamietnut() {
    if (!instrukcia.trim()) {
      return toast.error("Zadaj inštrukciu na úpravu dávky.");
    }
    vynes("zamietnute", instrukcia);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verdikt — meranie #{sequenceNo}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Parameter</TableHead>
              <TableHead className="text-right">Nameraná</TableHead>
              <TableHead className="text-right">Limit</TableHead>
              <TableHead className="text-right">Stav</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vysledky.map((v) => (
              <TableRow
                key={v.parameterId}
                className={cn(
                  !v.isWithinLimits && "bg-red-50 dark:bg-red-950/40",
                )}
              >
                <TableCell>
                  <span className="font-medium">{v.parameterCode}</span>
                  {v.parameterUnit && (
                    <span className="text-muted-foreground"> ({v.parameterUnit})</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {zobrazQty(v.value)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {limitPopis(v.minLimitSnapshot, v.maxLimitSnapshot)}
                </TableCell>
                <TableCell className="text-right">
                  {v.isWithinLimits ? (
                    <span className="text-emerald-600">v limite</span>
                  ) : (
                    <span className="font-semibold text-red-600">mimo</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {pocetMimo > 0 && (
          <p className="text-sm font-medium text-red-600">
            {pocetMimo} z {vysledky.length} parametrov je mimo limitu.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            className="h-16 bg-emerald-600 text-lg text-white hover:bg-emerald-700"
            disabled={pending}
            onClick={onSchvalit}
          >
            SCHVÁLIŤ
          </Button>
          <Button
            size="lg"
            className="h-16 bg-red-600 text-lg text-white hover:bg-red-700"
            disabled={pending}
            onClick={() => setZamietnutOpen(true)}
          >
            ZAMIETNUŤ
          </Button>
        </div>
      </CardContent>

      {/* Potvrdenie schválenia napriek hodnotám mimo limitu */}
      <Dialog open={schvalitOpen} onOpenChange={setSchvalitOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Schváliť napriek limitom?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {pocetMimo} parametrov je mimo limitu. Naozaj chceš dávku schváliť?
            </p>
            <Button
              size="lg"
              className="h-14 bg-emerald-600 text-base text-white hover:bg-emerald-700"
              disabled={pending}
              onClick={() => vynes("schvalene")}
            >
              {pending ? "Schvaľujem…" : "Áno, schváliť"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Zamietnutie s povinnou inštrukciou na úpravu dávky */}
      <Dialog open={zamietnutOpen} onOpenChange={setZamietnutOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Zamietnutie dávky</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="instrukcia">Inštrukcia na úpravu dávky *</Label>
              <Textarea
                id="instrukcia"
                placeholder="napr. Pridať 1,5 kg síry a znovu premiešať 5 min."
                value={instrukcia}
                onChange={(e) => setInstrukcia(e.target.value)}
                rows={3}
                autoFocus
              />
            </div>
            <Button
              size="lg"
              className="h-14 bg-red-600 text-base text-white hover:bg-red-700"
              disabled={pending}
              onClick={onZamietnut}
            >
              {pending ? "Zamietam…" : "Zamietnuť a odoslať na úpravu"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
