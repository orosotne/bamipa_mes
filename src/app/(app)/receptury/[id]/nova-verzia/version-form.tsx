"use client";

// Nová verzia receptúry — predvyplnená položkami aktuálnej verzie.
// Nemennosť starých verzií drží DB; toto je jediný spôsob úpravy receptu.
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { zobrazQty } from "@/lib/format";
import { vytvorVerziuAction } from "../../actions";

type Material = { id: string; code: string; name: string };
type Riadok = { key: number; materialId: string; qtyKg: string };

let dalsiKey = 1;

export function VersionForm({
  mixtureId,
  mixtureCode,
  novaVerzia,
  materialy,
  predvyplnene,
  stdKg,
  techNotes,
}: {
  mixtureId: string;
  mixtureCode: string;
  novaVerzia: number;
  materialy: Material[];
  predvyplnene: { materialId: string; qtyKg: string }[];
  stdKg: string;
  techNotes: string;
}) {
  const [riadky, setRiadky] = useState<Riadok[]>(
    predvyplnene.length > 0
      ? predvyplnene.map((p) => ({
          key: dalsiKey++,
          materialId: p.materialId,
          qtyKg: zobrazQty(p.qtyKg),
        }))
      : [{ key: dalsiKey++, materialId: "", qtyKg: "" }],
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function uprav(key: number, zmena: Partial<Riadok>) {
    setRiadky((prev) => prev.map((r) => (r.key === key ? { ...r, ...zmena } : r)));
  }

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const vysledok = await vytvorVerziuAction({
        mixtureId,
        standardBatchKg: String(formData.get("standardBatchKg") ?? ""),
        techNotes: String(formData.get("techNotes") ?? ""),
        polozky: riadky.map((r) => ({ materialId: r.materialId, qtyKg: r.qtyKg })),
      });
      if (vysledok.ok) {
        toast.success(`Verzia ${novaVerzia} vytvorená a aktivovaná.`);
        router.push(`/receptury/${mixtureId}`);
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  const materialItems = Object.fromEntries(
    materialy.map((m) => [m.id, `${m.code} — ${m.name}`]),
  );

  return (
    <form action={onSubmit} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {mixtureCode} — nová verzia {novaVerzia}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="standardBatchKg">Štandardná dávka (kg) *</Label>
            <Input
              id="standardBatchKg"
              name="standardBatchKg"
              defaultValue={zobrazQty(stdKg)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="techNotes">Technologické poznámky</Label>
            <Textarea
              id="techNotes"
              name="techNotes"
              rows={3}
              defaultValue={techNotes}
              placeholder="Postup miešania, teploty, časy…"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Položky (kg na štandardnú dávku)</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRiadky((prev) => [
                ...prev,
                { key: dalsiKey++, materialId: "", qtyKg: "" },
              ])
            }
          >
            <Plus className="h-4 w-4" /> Pridať položku
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {riadky.map((r) => (
            <div
              key={r.key}
              className="grid grid-cols-[1fr_9rem_2.5rem] items-center gap-2"
            >
              <Select
                items={materialItems}
                value={r.materialId}
                onValueChange={(v) => uprav(r.key, { materialId: v ?? "" })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Materiál (len v kg)" />
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
                placeholder="kg"
                className="text-right"
                value={r.qtyKg}
                onChange={(e) => uprav(r.key, { qtyKg: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Odstrániť položku"
                disabled={riadky.length === 1}
                onClick={() =>
                  setRiadky((prev) => prev.filter((x) => x.key !== r.key))
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Nová verzia sa po uložení stane aktívnou; predchádzajúce verzie
            ostávajú v histórii (dávky si pamätajú svoju verziu).
          </p>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Ukladám…" : `Vytvoriť verziu ${novaVerzia}`}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Zrušiť
        </Button>
      </div>
    </form>
  );
}
