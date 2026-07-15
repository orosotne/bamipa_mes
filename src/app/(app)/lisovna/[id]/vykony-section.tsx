"use client";

// D8 tablet-first: výkon per lis a zmena — veľké prvky, číselníky, draft
// v localStorage. Dávky ponúka server query LEN schválené labákom so
// zostatkom kg (tvrdú väzbu vynucuje aj DB trigger — §12).
import { Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatDatum, zobrazQty } from "@/lib/format";
import { ZMENY, type Zmena } from "@/lib/enums";
import { useFormDraft } from "@/lib/use-form-draft";
import { cn } from "@/lib/utils";
import { stornoVykonAction, zapisVykonAction } from "../actions";

type VykonRiadok = {
  id: string;
  runDate: string;
  shift: string;
  machineCode: string;
  davkaCislo: string;
  batchId: string;
  cyclesCount: number;
  pairsProduced: number;
  mixtureKg: string;
  workerName: string;
  note: string | null;
  nepodarky: { id: string; dovodName: string; qtyPairs: number }[];
  prestoje: { id: string; reasonName: string; minutes: number; note: string | null }[];
};
type Ciselnik = { id: string; name: string };
type Lis = { id: string; code: string; name: string };
type Davka = { id: string; batchNumber: string; zostatokKg: string };
type Pracovnik = { id: string; fullName: string };

type Draft = {
  runDate: string;
  shift: Zmena;
  machineId: string;
  batchId: string;
  cyclesCount: string;
  pairsProduced: string;
  mixtureKg: string;
  workerId: string;
  note: string;
  nepodarky: { defectReasonId: string; qtyPairs: string }[];
  prestoje: { reasonId: string; minutes: string }[];
};

export function VykonySection({
  workOrderId,
  vykony,
  lisy,
  davky,
  pracovnici,
  dovodyNepodarkov,
  dovodyPrestojov,
  dnes,
  editable,
}: {
  workOrderId: string;
  vykony: VykonRiadok[];
  lisy: Lis[];
  davky: Davka[];
  pracovnici: Pracovnik[];
  dovodyNepodarkov: Ciselnik[];
  dovodyPrestojov: Ciselnik[];
  dnes: string;
  editable: boolean;
}) {
  const prazdny: Draft = {
    runDate: dnes,
    shift: "ranna",
    machineId: "",
    batchId: "",
    cyclesCount: "",
    pairsProduced: "",
    mixtureKg: "",
    workerId: "",
    note: "",
    nepodarky: [],
    prestoje: [],
  };
  const [draft, setDraft, clearDraft] = useFormDraft<Draft>(
    `bamipa:lisovna:${workOrderId}:vykon`,
    prazdny,
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function uprav(zmena: Partial<Draft>) {
    setDraft({ ...draft, ...zmena });
  }

  function onSubmit() {
    if (!draft.machineId) return toast.error("Vyber lis.");
    if (!draft.batchId) return toast.error("Vyber dávku zmesi.");
    if (!draft.cyclesCount.trim()) return toast.error("Zadaj počet cyklov.");
    if (!draft.pairsProduced.trim()) return toast.error("Zadaj vyrobené páry.");
    if (!draft.mixtureKg.trim()) return toast.error("Zadaj spotrebu zmesi.");
    if (!draft.workerId) return toast.error("Vyber obsluhu.");
    if (draft.nepodarky.some((n) => !n.defectReasonId || !n.qtyPairs.trim())) {
      return toast.error("Doplň dôvod aj počet pri každom nepodarku.");
    }
    if (draft.prestoje.some((p) => !p.reasonId || !p.minutes.trim())) {
      return toast.error("Doplň dôvod aj minúty pri každom prestoji.");
    }

    startTransition(async () => {
      const vysledok = await zapisVykonAction({
        workOrderId,
        machineId: draft.machineId,
        batchId: draft.batchId,
        runDate: draft.runDate,
        shift: draft.shift,
        cyclesCount: draft.cyclesCount,
        pairsProduced: draft.pairsProduced,
        mixtureKg: draft.mixtureKg,
        workerId: draft.workerId,
        note: draft.note,
        nepodarky: draft.nepodarky,
        prestoje: draft.prestoje,
      });
      if (vysledok.ok) {
        toast.success("Výkon zapísaný.");
        clearDraft({ ...prazdny, runDate: draft.runDate, shift: draft.shift });
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  function onStorno(vykon: VykonRiadok) {
    if (
      !window.confirm(
        `Stornovať výkon z ${formatDatum(vykon.runDate)} (${vykon.machineCode})?`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const vysledok = await stornoVykonAction({ id: vykon.id, workOrderId });
      if (vysledok.ok) {
        toast.success("Výkon stornovaný.");
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  const lisItems = Object.fromEntries(
    lisy.map((l) => [l.id, `${l.code} — ${l.name}`]),
  );
  const davkaItems = Object.fromEntries(
    davky.map((d) => [
      d.id,
      `${d.batchNumber} (zostatok ${zobrazQty(d.zostatokKg)} kg)`,
    ]),
  );
  const pracovnikItems = Object.fromEntries(
    pracovnici.map((p) => [p.id, p.fullName]),
  );
  const nepodarokItems = Object.fromEntries(
    dovodyNepodarkov.map((d) => [d.id, d.name]),
  );
  const prestojItems = Object.fromEntries(
    dovodyPrestojov.map((d) => [d.id, d.name]),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Výkony lisov</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {vykony.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dátum</TableHead>
                <TableHead>Zmena</TableHead>
                <TableHead>Lis</TableHead>
                <TableHead>Dávka</TableHead>
                <TableHead className="text-right">Cykly</TableHead>
                <TableHead className="text-right">Páry (dobré)</TableHead>
                <TableHead className="text-right">Zmes kg</TableHead>
                <TableHead>Obsluha</TableHead>
                {editable && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {vykony.map((v) => {
                const detaily: string[] = [];
                if (v.nepodarky.length > 0) {
                  detaily.push(
                    `Nepodarky: ${v.nepodarky
                      .map((n) => `${n.dovodName} ${n.qtyPairs} ks`)
                      .join(", ")}`,
                  );
                }
                if (v.prestoje.length > 0) {
                  detaily.push(
                    `Prestoje: ${v.prestoje
                      .map(
                        (p) =>
                          `${p.reasonName} ${p.minutes} min${p.note ? ` (${p.note})` : ""}`,
                      )
                      .join(", ")}`,
                  );
                }
                if (v.note) detaily.push(`Poznámka: ${v.note}`);
                return (
                  <Fragment key={v.id}>
                    <TableRow>
                      <TableCell>{formatDatum(v.runDate)}</TableCell>
                      <TableCell>
                        {ZMENY[v.shift as Zmena] ?? v.shift}
                      </TableCell>
                      <TableCell>{v.machineCode}</TableCell>
                      <TableCell>{v.davkaCislo}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {v.cyclesCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {v.pairsProduced}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {zobrazQty(v.mixtureKg)}
                      </TableCell>
                      <TableCell>{v.workerName}</TableCell>
                      {editable && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Stornovať výkon"
                            disabled={pending}
                            onClick={() => onStorno(v)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                    {detaily.length > 0 && (
                      <TableRow className="border-t-0">
                        <TableCell
                          colSpan={editable ? 9 : 8}
                          className="pt-0 text-xs text-muted-foreground"
                        >
                          {detaily.join(" · ")}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}

        {editable && (
          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <div className="text-sm font-medium">Nový výkon</div>

            {davky.length === 0 && (
              <p className="text-sm text-amber-600">
                Žiadna schválená dávka zmesi{" "}
                so zostatkom — lisovať možno len zmes schválenú labákom.
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="runDate">Dátum *</Label>
                <Input
                  id="runDate"
                  type="date"
                  className="h-12 text-base"
                  value={draft.runDate}
                  onChange={(e) => uprav({ runDate: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Zmena *</Label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(ZMENY).map(([k, label]) => (
                    <Button
                      key={k}
                      type="button"
                      variant={draft.shift === k ? "default" : "outline"}
                      className={cn("h-12 text-sm")}
                      onClick={() => uprav({ shift: k as Zmena })}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Lis *</Label>
                <Select
                  items={lisItems}
                  value={draft.machineId}
                  onValueChange={(v) => uprav({ machineId: v ?? "" })}
                >
                  <SelectTrigger className="h-12 w-full text-base">
                    <SelectValue placeholder="Vyber lis" />
                  </SelectTrigger>
                  <SelectContent>
                    {lisy.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.code} — {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Dávka zmesi (len schválené) *</Label>
                <Select
                  items={davkaItems}
                  value={draft.batchId}
                  onValueChange={(v) => uprav({ batchId: v ?? "" })}
                >
                  <SelectTrigger className="h-12 w-full text-base">
                    <SelectValue placeholder="Vyber dávku" />
                  </SelectTrigger>
                  <SelectContent>
                    {davky.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.batchNumber} (zostatok {zobrazQty(d.zostatokKg)} kg)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cycles">Počet cyklov *</Label>
                <Input
                  id="cycles"
                  inputMode="numeric"
                  className="h-12 text-base"
                  value={draft.cyclesCount}
                  onChange={(e) => uprav({ cyclesCount: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pairs">Vyrobené páry (dobré) *</Label>
                <Input
                  id="pairs"
                  inputMode="numeric"
                  className="h-12 text-base"
                  value={draft.pairsProduced}
                  onChange={(e) => uprav({ pairsProduced: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="kg">Spotreba zmesi (kg) *</Label>
                <Input
                  id="kg"
                  inputMode="decimal"
                  className="h-12 text-base"
                  placeholder="napr. 42,5"
                  value={draft.mixtureKg}
                  onChange={(e) => uprav({ mixtureKg: e.target.value })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Obsluha *</Label>
              <Select
                items={pracovnikItems}
                value={draft.workerId}
                onValueChange={(v) => uprav({ workerId: v ?? "" })}
              >
                <SelectTrigger className="h-12 w-full text-base">
                  <SelectValue placeholder="Vyber pracovníka" />
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

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Nepodarky</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    uprav({
                      nepodarky: [
                        ...draft.nepodarky,
                        { defectReasonId: "", qtyPairs: "" },
                      ],
                    })
                  }
                >
                  + Pridať nepodarok
                </Button>
              </div>
              {draft.nepodarky.map((n, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_7rem_auto] items-center gap-2"
                >
                  <Select
                    items={nepodarokItems}
                    value={n.defectReasonId}
                    onValueChange={(v) =>
                      uprav({
                        nepodarky: draft.nepodarky.map((x, xi) =>
                          xi === i ? { ...x, defectReasonId: v ?? "" } : x,
                        ),
                      })
                    }
                  >
                    <SelectTrigger className="h-12 w-full text-base">
                      <SelectValue placeholder="Dôvod" />
                    </SelectTrigger>
                    <SelectContent>
                      {dovodyNepodarkov.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    inputMode="numeric"
                    placeholder="Páry"
                    className="h-12 text-base"
                    value={n.qtyPairs}
                    onChange={(e) =>
                      uprav({
                        nepodarky: draft.nepodarky.map((x, xi) =>
                          xi === i ? { ...x, qtyPairs: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Odobrať nepodarok"
                    onClick={() =>
                      uprav({
                        nepodarky: draft.nepodarky.filter((_, xi) => xi !== i),
                      })
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Prestoje</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    uprav({
                      prestoje: [
                        ...draft.prestoje,
                        { reasonId: "", minutes: "" },
                      ],
                    })
                  }
                >
                  + Pridať prestoj
                </Button>
              </div>
              {draft.prestoje.map((p, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_7rem_auto] items-center gap-2"
                >
                  <Select
                    items={prestojItems}
                    value={p.reasonId}
                    onValueChange={(v) =>
                      uprav({
                        prestoje: draft.prestoje.map((x, xi) =>
                          xi === i ? { ...x, reasonId: v ?? "" } : x,
                        ),
                      })
                    }
                  >
                    <SelectTrigger className="h-12 w-full text-base">
                      <SelectValue placeholder="Dôvod" />
                    </SelectTrigger>
                    <SelectContent>
                      {dovodyPrestojov.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    inputMode="numeric"
                    placeholder="Minúty"
                    className="h-12 text-base"
                    value={p.minutes}
                    onChange={(e) =>
                      uprav({
                        prestoje: draft.prestoje.map((x, xi) =>
                          xi === i ? { ...x, minutes: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Odobrať prestoj"
                    onClick={() =>
                      uprav({
                        prestoje: draft.prestoje.filter((_, xi) => xi !== i),
                      })
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vykonNote">Poznámka</Label>
              <Input
                id="vykonNote"
                className="h-12 text-base"
                value={draft.note}
                onChange={(e) => uprav({ note: e.target.value })}
              />
            </div>

            <Button
              size="lg"
              className="h-14 text-base"
              disabled={pending || davky.length === 0}
              onClick={onSubmit}
            >
              {pending ? "Zapisujem…" : "Zapísať výkon"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
