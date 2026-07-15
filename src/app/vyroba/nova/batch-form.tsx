"use client";

// D8 tablet-first: veľké dotykové prvky (zmena ako 3 tlačidlá), číselníky
// namiesto voľného textu, draft v localStorage — formulár nesmie stratiť
// rozpísaný záznam pri náhodnom zatvorení tabletu.
import { useRouter } from "next/navigation";
import { useTransition } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { ZMENY, type Zmena } from "@/lib/enums";
import { useFormDraft } from "@/lib/use-form-draft";
import { cn } from "@/lib/utils";
import { zalozDavkuAction } from "../actions";

type Zmes = { id: string; code: string; name: string };
type Stroj = { id: string; code: string; name: string };
type Pracovnik = { id: string; fullName: string };

type Draft = {
  mixtureId: string;
  productionDate: string;
  shift: Zmena;
  machineId: string;
  leadWorkerId: string;
  scaleFactor: string;
  note: string;
};

export function BatchForm({
  zmesi,
  stroje,
  pracovnici,
  dnes,
}: {
  zmesi: Zmes[];
  stroje: Stroj[];
  pracovnici: Pracovnik[];
  dnes: string;
}) {
  const [draft, setDraft, clearDraft] = useFormDraft<Draft>("bamipa:vyroba:nova", {
    mixtureId: "",
    productionDate: dnes,
    shift: "ranna",
    machineId: "",
    leadWorkerId: "",
    scaleFactor: "1",
    note: "",
  });
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function uprav(zmena: Partial<Draft>) {
    setDraft({ ...draft, ...zmena });
  }

  function onSubmit() {
    if (!draft.mixtureId) return toast.error("Vyber zmes.");
    if (!draft.machineId) return toast.error("Vyber stroj.");
    if (!draft.leadWorkerId) return toast.error("Vyber obsluhu.");

    startTransition(async () => {
      const vysledok = await zalozDavkuAction({
        mixtureId: draft.mixtureId,
        productionDate: draft.productionDate,
        shift: draft.shift,
        machineId: draft.machineId,
        leadWorkerId: draft.leadWorkerId,
        scaleFactor: draft.scaleFactor,
        note: draft.note,
      });
      if (vysledok.ok && vysledok.id) {
        toast.success("Dávka založená.");
        clearDraft();
        router.push(`/vyroba/${vysledok.id}`);
      } else if (vysledok.ok) {
        toast.success("Dávka založená.");
        clearDraft();
        router.push("/vyroba");
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  const zmesItems = Object.fromEntries(zmesi.map((z) => [z.id, `${z.code} — ${z.name}`]));
  const strojItems = Object.fromEntries(stroje.map((s) => [s.id, `${s.code} — ${s.name}`]));
  const pracovnikItems = Object.fromEntries(pracovnici.map((p) => [p.id, p.fullName]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Založenie dávky</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {zmesi.length === 0 ? (
          <p className="text-sm text-amber-600">
            Žiadna zmes nemá aktívnu verziu receptu — aktivuj ju v Receptúrach.
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label>Zmes *</Label>
          <Select
            items={zmesItems}
            value={draft.mixtureId}
            onValueChange={(v) => uprav({ mixtureId: v ?? "" })}
          >
            <SelectTrigger className="h-12 w-full text-base">
              <SelectValue placeholder="Vyber zmes" />
            </SelectTrigger>
            <SelectContent>
              {zmesi.map((z) => (
                <SelectItem key={z.id} value={z.id}>
                  {z.code} — {z.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="productionDate">Dátum výroby *</Label>
            <Input
              id="productionDate"
              type="date"
              className="h-12 text-base"
              value={draft.productionDate}
              onChange={(e) => uprav({ productionDate: e.target.value })}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scaleFactor">Násobok dávky (scale factor)</Label>
            <Input
              id="scaleFactor"
              className="h-12 text-base"
              placeholder="napr. 1 alebo 2,5"
              value={draft.scaleFactor}
              onChange={(e) => uprav({ scaleFactor: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Zmena *</Label>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(ZMENY).map(([k, label]) => (
              <Button
                key={k}
                type="button"
                size="lg"
                variant={draft.shift === k ? "default" : "outline"}
                className={cn("h-14 text-base")}
                onClick={() => uprav({ shift: k as Zmena })}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Stroj *</Label>
            <Select
              items={strojItems}
              value={draft.machineId}
              onValueChange={(v) => uprav({ machineId: v ?? "" })}
            >
              <SelectTrigger className="h-12 w-full text-base">
                <SelectValue placeholder="Vyber stroj" />
              </SelectTrigger>
              <SelectContent>
                {stroje.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Obsluha *</Label>
            <Select
              items={pracovnikItems}
              value={draft.leadWorkerId}
              onValueChange={(v) => uprav({ leadWorkerId: v ?? "" })}
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
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="note">Poznámka</Label>
          <Textarea
            id="note"
            value={draft.note}
            onChange={(e) => uprav({ note: e.target.value })}
          />
        </div>

        <div className="flex gap-3">
          <Button size="lg" className="h-14 flex-1 text-base" disabled={pending} onClick={onSubmit}>
            {pending ? "Zakladám…" : "Založiť dávku"}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-14 text-base"
            onClick={() => {
              clearDraft();
              router.push("/vyroba");
            }}
          >
            Zrušiť
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
