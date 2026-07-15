"use client";

// M5 Labák — úprava dávky (rework) po zamietnutí. Majster valcovne dopĺňa dávku:
// dodatočný výdaj materiálu a práca (viazané na adjustment_id), potom ju znovu
// odovzdá na labák. Vícenáklady vedie v_batch_costs ako rework.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { zobrazQty } from "@/lib/format";
import { useFormDraft } from "@/lib/use-form-draft";
import { SubmitToLabDialog } from "./submit-to-lab-dialog";
import { pridajPracuReworkAction, vydajReworkAction } from "../rework-actions";

type Vydaj = {
  id: string;
  materialCode: string;
  materialName: string;
  qtyDelta: string;
};
type Praca = { id: string; workerName: string; hours: string; workDate: string };
type Material = { id: string; code: string; name: string };
type Pracovnik = { id: string; fullName: string };
type VydajDraft = { materialId: string; qty: string };
type PracaDraft = { workerId: string; workDate: string; hours: string };

export function ReworkSection({
  batchId,
  adjustmentId,
  instrukcia,
  triggeredBySequenceNo,
  vydaje,
  praca,
  materialy,
  pracovnici,
  productionDate,
}: {
  batchId: string;
  adjustmentId: string;
  instrukcia: string | null;
  triggeredBySequenceNo: number | null;
  vydaje: Vydaj[];
  praca: Praca[];
  materialy: Material[];
  pracovnici: Pracovnik[];
  productionDate: string;
}) {
  const [vydajDraft, setVydajDraft, clearVydajDraft] = useFormDraft<VydajDraft>(
    `bamipa:rework:${batchId}:vydaj`,
    { materialId: "", qty: "" },
  );
  const [pracaDraft, setPracaDraft, clearPracaDraft] = useFormDraft<PracaDraft>(
    `bamipa:rework:${batchId}:praca`,
    { workerId: "", workDate: productionDate, hours: "" },
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function vydajRework() {
    if (!vydajDraft.materialId) return toast.error("Vyber materiál.");
    if (!vydajDraft.qty.trim()) return toast.error("Zadaj množstvo (kg).");
    startTransition(async () => {
      const r = await vydajReworkAction({
        batchId,
        adjustmentId,
        materialId: vydajDraft.materialId,
        qty: vydajDraft.qty,
      });
      if (r.ok) {
        toast.success("Dodatočný výdaj zapísaný.");
        clearVydajDraft({ materialId: "", qty: "" });
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  function pracaRework() {
    if (!pracaDraft.workerId) return toast.error("Vyber pracovníka.");
    if (!pracaDraft.hours.trim()) return toast.error("Zadaj hodiny.");
    startTransition(async () => {
      const r = await pridajPracuReworkAction({
        batchId,
        adjustmentId,
        workerId: pracaDraft.workerId,
        workDate: pracaDraft.workDate,
        hours: pracaDraft.hours,
      });
      if (r.ok) {
        toast.success("Dodatočná práca zapísaná.");
        clearPracaDraft({ workerId: "", workDate: productionDate, hours: "" });
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  const materialItems = Object.fromEntries(
    materialy.map((m) => [m.id, `${m.code} — ${m.name}`]),
  );
  const pracovnikItems = Object.fromEntries(
    pracovnici.map((p) => [p.id, p.fullName]),
  );

  return (
    <Card className="border-amber-300 dark:border-amber-900">
      <CardHeader>
        <CardTitle>Úprava dávky (rework)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <span className="text-muted-foreground">
            Inštrukcia labáku
            {triggeredBySequenceNo != null && ` (meranie #${triggeredBySequenceNo})`}
            :{" "}
          </span>
          <span className="font-medium">{instrukcia ?? "—"}</span>
        </div>

        {(vydaje.length > 0 || praca.length > 0) && (
          <div className="flex flex-col gap-3">
            {vydaje.length > 0 && (
              <div>
                <div className="mb-1 text-sm font-medium">Dodatočný materiál</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Materiál</TableHead>
                      <TableHead className="text-right">Množstvo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vydaje.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>
                          {v.materialCode} — {v.materialName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {zobrazQty(v.qtyDelta.replace("-", ""))} kg
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {praca.length > 0 && (
              <div>
                <div className="mb-1 text-sm font-medium">Dodatočná práca</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pracovník</TableHead>
                      <TableHead>Dátum</TableHead>
                      <TableHead className="text-right">Hodiny</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {praca.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.workerName}</TableCell>
                        <TableCell>{p.workDate}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.hours}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* Formulár dodatočného výdaja */}
        <div className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
          <Select
            items={materialItems}
            value={vydajDraft.materialId}
            onValueChange={(v) =>
              setVydajDraft({ ...vydajDraft, materialId: v ?? "" })
            }
          >
            <SelectTrigger className="h-12 w-full text-base">
              <SelectValue placeholder="Materiál" />
            </SelectTrigger>
            <SelectContent>
              {materialy.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.code} — {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            inputMode="decimal"
            placeholder="kg"
            className="h-12 text-base"
            value={vydajDraft.qty}
            onChange={(e) =>
              setVydajDraft({ ...vydajDraft, qty: e.target.value })
            }
          />
          <Button size="lg" className="h-12" disabled={pending} onClick={vydajRework}>
            Vydať
          </Button>
        </div>

        {/* Formulár dodatočnej práce */}
        <div className="grid grid-cols-[1fr_9rem_7rem_auto] items-end gap-2">
          <Select
            items={pracovnikItems}
            value={pracaDraft.workerId}
            onValueChange={(v) =>
              setPracaDraft({ ...pracaDraft, workerId: v ?? "" })
            }
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
          <Input
            type="date"
            className="h-12 text-base"
            value={pracaDraft.workDate}
            onChange={(e) =>
              setPracaDraft({ ...pracaDraft, workDate: e.target.value })
            }
          />
          <Input
            placeholder="Hodiny"
            className="h-12 text-base"
            value={pracaDraft.hours}
            onChange={(e) =>
              setPracaDraft({ ...pracaDraft, hours: e.target.value })
            }
          />
          <Button size="lg" className="h-12" disabled={pending} onClick={pracaRework}>
            Pridať
          </Button>
        </div>

        <SubmitToLabDialog batchId={batchId} label="Znovu odovzdať na labák" />
      </CardContent>
    </Card>
  );
}
