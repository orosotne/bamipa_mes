"use client";

// M5 Labák — formulár zápisu meraní (tablet-first). Predvyplnené parametre podľa
// definícií zmesi, veľké dotykové inputy, okamžitá vizuálna indikácia mimo limitu.
import { Check, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { zobrazQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useFormDraft } from "@/lib/use-form-draft";
import { zapisMeraniaAction } from "../actions";

type Definicia = {
  parameterId: string;
  code: string;
  name: string;
  unit: string | null;
  minValue: string | null;
  maxValue: string | null;
};

type Stav = "prazdne" | "ok" | "mimo";

function vyhodnot(
  raw: string,
  min: string | null,
  max: string | null,
): Stav {
  const t = raw.replace(",", ".").trim();
  // Zhodné so serverom (numeric(10,3)) — >3 desatiny sú nevalidné, nie „ok",
  // aby indikátor netvrdil „v limite" pri hodnote, ktorú server odmietne.
  if (t === "" || !/^-?\d+(\.\d{1,3})?$/.test(t)) return "prazdne";
  const v = Number(t);
  if (min !== null && v < Number(min)) return "mimo";
  if (max !== null && v > Number(max)) return "mimo";
  return "ok";
}

function limitPopis(min: string | null, max: string | null): string {
  if (min !== null && max !== null)
    return `${zobrazQty(min)} – ${zobrazQty(max)}`;
  if (min !== null) return `≥ ${zobrazQty(min)}`;
  if (max !== null) return `≤ ${zobrazQty(max)}`;
  return "bez limitu";
}

export function MeasurementForm({
  batchId,
  definicie,
}: {
  batchId: string;
  definicie: Definicia[];
}) {
  const [draft, setDraft, clearDraft] = useFormDraft<Record<string, string>>(
    `bamipa:labak:${batchId}:merania`,
    Object.fromEntries(definicie.map((d) => [d.parameterId, ""])),
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit() {
    const chybajuce = definicie.filter(
      (d) => !(draft[d.parameterId] ?? "").trim(),
    );
    if (chybajuce.length > 0) {
      return toast.error(
        `Doplň všetky parametre (chýba: ${chybajuce
          .map((d) => d.code)
          .join(", ")}).`,
      );
    }

    startTransition(async () => {
      const vysledok = await zapisMeraniaAction({
        batchId,
        merania: definicie.map((d) => ({
          parameterId: d.parameterId,
          value: draft[d.parameterId],
        })),
      });
      if (vysledok.ok) {
        toast.success("Meranie zapísané — vynes verdikt.");
        clearDraft(Object.fromEntries(definicie.map((d) => [d.parameterId, ""])));
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  const pocetMimo = definicie.filter(
    (d) => vyhodnot(draft[d.parameterId] ?? "", d.minValue, d.maxValue) === "mimo",
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Zápis meraní</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {definicie.map((d) => {
          const raw = draft[d.parameterId] ?? "";
          const stav = vyhodnot(raw, d.minValue, d.maxValue);
          return (
            <div
              key={d.parameterId}
              className={cn(
                "flex items-center gap-4 rounded-lg border p-3",
                stav === "mimo" &&
                  "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
                stav === "ok" &&
                  "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40",
              )}
            >
              <div className="flex-1">
                <div className="text-base font-semibold">
                  {d.code}
                  {d.unit && (
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      ({d.unit})
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {d.name} · limit {limitPopis(d.minValue, d.maxValue)}
                </div>
              </div>
              <Input
                inputMode="decimal"
                className="h-14 w-32 text-right text-lg tabular-nums"
                placeholder="0"
                value={raw}
                onChange={(e) =>
                  setDraft({ ...draft, [d.parameterId]: e.target.value })
                }
              />
              <div className="w-6">
                {stav === "ok" && (
                  <Check className="h-6 w-6 text-emerald-600" aria-label="v limite" />
                )}
                {stav === "mimo" && (
                  <TriangleAlert
                    className="h-6 w-6 text-red-600"
                    aria-label="mimo limitu"
                  />
                )}
              </div>
            </div>
          );
        })}

        {pocetMimo > 0 && (
          <p className="text-sm font-medium text-red-600">
            {pocetMimo}{" "}
            {pocetMimo === 1
              ? "parameter je"
              : pocetMimo < 5
                ? "parametre sú"
                : "parametrov je"}{" "}
            mimo limitu.
          </p>
        )}

        <Button
          size="lg"
          className="h-16 w-full text-lg"
          disabled={pending}
          onClick={onSubmit}
        >
          {pending ? "Zapisujem…" : "Zapísať meranie"}
        </Button>
      </CardContent>
    </Card>
  );
}
