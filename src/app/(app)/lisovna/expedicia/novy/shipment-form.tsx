"use client";

// D8 tablet-first: dodací list pre odberateľa (prefill LOWA). Položky viazané
// na výrobné príkazy s voľnými pármi — sklad hotových stráži aj DB trigger.
import { X } from "lucide-react";
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
import { useFormDraft } from "@/lib/use-form-draft";
import { vytvorDodaciListAction } from "../../actions";

type Prikaz = {
  id: string;
  orderNumber: string;
  artikelCode: string;
  artikelName: string;
  dostupne: number;
};

type Draft = {
  shipDate: string;
  customer: string;
  note: string;
  polozky: { workOrderId: string; qtyPairs: string }[];
};

export function ShipmentForm({
  prikazy,
  dnes,
}: {
  prikazy: Prikaz[];
  dnes: string;
}) {
  const [draft, setDraft, clearDraft] = useFormDraft<Draft>(
    "bamipa:lisovna:expedicia:novy",
    {
      shipDate: dnes,
      customer: "LOWA",
      note: "",
      polozky: [{ workOrderId: "", qtyPairs: "" }],
    },
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function uprav(zmena: Partial<Draft>) {
    setDraft({ ...draft, ...zmena });
  }

  function onSubmit() {
    if (!draft.customer.trim()) return toast.error("Zadaj odberateľa.");
    const polozky = draft.polozky.filter(
      (p) => p.workOrderId || p.qtyPairs.trim(),
    );
    if (polozky.length === 0) return toast.error("Pridaj aspoň jednu položku.");
    if (polozky.some((p) => !p.workOrderId || !p.qtyPairs.trim())) {
      return toast.error("Doplň príkaz aj počet párov pri každej položke.");
    }

    startTransition(async () => {
      const vysledok = await vytvorDodaciListAction({
        shipDate: draft.shipDate,
        customer: draft.customer,
        note: draft.note,
        polozky,
      });
      if (vysledok.ok && vysledok.id) {
        toast.success("Dodací list vytvorený.");
        clearDraft();
        router.push(`/lisovna/expedicia/${vysledok.id}`);
      } else if (vysledok.ok) {
        toast.success("Dodací list vytvorený.");
        clearDraft();
        router.push("/lisovna/expedicia");
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  const prikazItems = Object.fromEntries(
    prikazy.map((p) => [
      p.id,
      `${p.orderNumber} — ${p.artikelCode} (voľných ${p.dostupne} párov)`,
    ]),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dodací list</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {prikazy.length === 0 ? (
          <p className="text-sm text-amber-600">
            Žiadny príkaz nemá voľné hotové páry na expedíciu.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shipDate">Dátum expedície *</Label>
            <Input
              id="shipDate"
              type="date"
              className="h-12 text-base"
              value={draft.shipDate}
              onChange={(e) => uprav({ shipDate: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customer">Odberateľ *</Label>
            <Input
              id="customer"
              className="h-12 text-base"
              value={draft.customer}
              onChange={(e) => uprav({ customer: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Položky *</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                uprav({
                  polozky: [
                    ...draft.polozky,
                    { workOrderId: "", qtyPairs: "" },
                  ],
                })
              }
            >
              + Pridať položku
            </Button>
          </div>
          {draft.polozky.map((p, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_7rem_auto] items-center gap-2"
            >
              <Select
                items={prikazItems}
                value={p.workOrderId}
                onValueChange={(v) =>
                  uprav({
                    polozky: draft.polozky.map((x, xi) =>
                      xi === i ? { ...x, workOrderId: v ?? "" } : x,
                    ),
                  })
                }
              >
                <SelectTrigger className="h-12 w-full text-base">
                  <SelectValue placeholder="Výrobný príkaz" />
                </SelectTrigger>
                <SelectContent>
                  {prikazy.map((pr) => (
                    <SelectItem key={pr.id} value={pr.id}>
                      {pr.orderNumber} — {pr.artikelCode} (voľných {pr.dostupne}
                      {" "}párov)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                inputMode="numeric"
                placeholder="Páry"
                className="h-12 text-base"
                value={p.qtyPairs}
                onChange={(e) =>
                  uprav({
                    polozky: draft.polozky.map((x, xi) =>
                      xi === i ? { ...x, qtyPairs: e.target.value } : x,
                    ),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Odobrať položku"
                onClick={() =>
                  uprav({
                    polozky: draft.polozky.filter((_, xi) => xi !== i),
                  })
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
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
          <Button
            size="lg"
            className="h-14 flex-1 text-base"
            disabled={pending || prikazy.length === 0}
            onClick={onSubmit}
          >
            {pending ? "Vytváram…" : "Vytvoriť dodací list"}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-14 text-base"
            onClick={() => {
              clearDraft();
              router.push("/lisovna/expedicia");
            }}
          >
            Zrušiť
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
