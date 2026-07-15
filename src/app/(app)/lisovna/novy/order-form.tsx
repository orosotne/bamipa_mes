"use client";

// D8 tablet-first: veľké dotykové prvky, číselníky namiesto voľného textu,
// draft v localStorage — formulár nesmie stratiť rozpísaný záznam.
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
import { VETVY_PRIPRAVY, type VetvaPripravy } from "@/lib/enums";
import { useFormDraft } from "@/lib/use-form-draft";
import { cn } from "@/lib/utils";
import { zalozPrikazAction } from "../actions";

type Artikel = { id: string; code: string; name: string; zmesCode: string };

type Draft = {
  soleModelId: string;
  qtyPairsPlanned: string;
  prepBranch: VetvaPripravy | null;
  note: string;
};

export function OrderForm({ artikle }: { artikle: Artikel[] }) {
  const [draft, setDraft, clearDraft] = useFormDraft<Draft>(
    "bamipa:lisovna:novy",
    { soleModelId: "", qtyPairsPlanned: "", prepBranch: null, note: "" },
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function uprav(zmena: Partial<Draft>) {
    setDraft({ ...draft, ...zmena });
  }

  function onSubmit() {
    if (!draft.soleModelId) return toast.error("Vyber artikel.");
    if (!draft.qtyPairsPlanned.trim()) return toast.error("Zadaj počet párov.");

    startTransition(async () => {
      const vysledok = await zalozPrikazAction({
        soleModelId: draft.soleModelId,
        qtyPairsPlanned: draft.qtyPairsPlanned,
        prepBranch: draft.prepBranch,
        note: draft.note,
      });
      if (vysledok.ok && vysledok.id) {
        toast.success("Príkaz založený.");
        clearDraft();
        router.push(`/lisovna/${vysledok.id}`);
      } else if (vysledok.ok) {
        toast.success("Príkaz založený.");
        clearDraft();
        router.push("/lisovna");
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  const artikelItems = Object.fromEntries(
    artikle.map((a) => [a.id, `${a.code} — ${a.name} (${a.zmesCode})`]),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Založenie príkazu</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {artikle.length === 0 ? (
          <p className="text-sm text-amber-600">
            Žiadny aktívny artikel — najprv ho založ v katalógu artiklov.
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label>Artikel (model podošvy) *</Label>
          <Select
            items={artikelItems}
            value={draft.soleModelId}
            onValueChange={(v) => uprav({ soleModelId: v ?? "" })}
          >
            <SelectTrigger className="h-12 w-full text-base">
              <SelectValue placeholder="Vyber artikel" />
            </SelectTrigger>
            <SelectContent>
              {artikle.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.code} — {a.name} ({a.zmesCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qtyPairs">Množstvo párov *</Label>
          <Input
            id="qtyPairs"
            inputMode="numeric"
            className="h-12 text-base"
            placeholder="napr. 500"
            value={draft.qtyPairsPlanned}
            onChange={(e) => uprav({ qtyPairsPlanned: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Vetva prípravy zmesi</Label>
          <div className="grid grid-cols-2 gap-2">
            {(
              Object.entries(VETVY_PRIPRAVY) as [VetvaPripravy, string][]
            ).map(([k, label]) => (
              <Button
                key={k}
                type="button"
                size="lg"
                variant={draft.prepBranch === k ? "default" : "outline"}
                className={cn("h-14 text-base")}
                onClick={() =>
                  uprav({ prepBranch: draft.prepBranch === k ? null : k })
                }
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Voliteľné — opätovným ťuknutím sa výber zruší.
          </p>
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
            disabled={pending}
            onClick={onSubmit}
          >
            {pending ? "Zakladám…" : "Založiť príkaz"}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-14 text-base"
            onClick={() => {
              clearDraft();
              router.push("/lisovna");
            }}
          >
            Zrušiť
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
