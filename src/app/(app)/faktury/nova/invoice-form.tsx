"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
import { KATEGORIE_FAKTUR } from "@/lib/enums";
import { formatCentsToEur, parseEurToCents } from "@/lib/format";
import { vytvorFakturuAction } from "../actions";

const sumaEur = z
  .string()
  .trim()
  .min(1, "Suma je povinná.")
  .refine((v) => {
    try {
      parseEurToCents(v);
      return true;
    } catch {
      return false;
    }
  }, "Neplatná suma (napr. 1 234,56).");

const formSchema = z.object({
  supplierId: z.string().min(1, "Vyber dodávateľa."),
  invoiceNumber: z.string().trim().min(1, "Číslo faktúry je povinné."),
  issueDate: z.string().optional(),
  deliveryDate: z.string().optional(),
  dueDate: z.string().min(1, "Dátum splatnosti je povinný."),
  sumaNetEur: sumaEur,
  sumaVatEur: sumaEur,
  note: z.string().optional(),
  polozky: z
    .array(
      z.object({
        description: z.string().trim().min(1, "Popis je povinný."),
        category: z.enum(["material", "energia", "sluzby", "investicia", "rezia"]),
        costCenterId: z.string().min(1, "Vyber stredisko."),
        sumaNetEur: sumaEur,
      }),
    )
    .min(1, "Aspoň jedna položka."),
});

type FormValues = z.input<typeof formSchema>;

function bezpecneCenty(v: string): number | null {
  try {
    return parseEurToCents(v);
  } catch {
    return null;
  }
}

export function InvoiceForm({
  dodavatelia,
  strediska,
}: {
  dodavatelia: { id: string; name: string }[];
  strediska: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      supplierId: "",
      invoiceNumber: "",
      issueDate: "",
      deliveryDate: "",
      dueDate: "",
      sumaNetEur: "",
      sumaVatEur: "",
      note: "",
      polozky: [
        { description: "", category: "material", costCenterId: "", sumaNetEur: "" },
      ],
    },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "polozky",
  });

  const hodnoty = form.watch();
  const netCents = bezpecneCenty(hodnoty.sumaNetEur ?? "");
  const vatCents = bezpecneCenty(hodnoty.sumaVatEur ?? "");
  const sumaPoloziek = (hodnoty.polozky ?? []).reduce((sum, p) => {
    const c = bezpecneCenty(p?.sumaNetEur ?? "");
    return c === null ? sum : sum + c;
  }, 0);
  const polozkySedia = netCents !== null && sumaPoloziek === netCents;

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const vysledok = await vytvorFakturuAction(values);
      if (vysledok.ok) {
        toast.success("Faktúra zaevidovaná.");
        router.push(vysledok.id ? `/faktury/${vysledok.id}` : "/faktury");
        router.refresh();
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  const chyba = (cesta: string) => {
    const parts = cesta.split(".");
    let e: unknown = form.formState.errors;
    for (const p of parts) e = (e as Record<string, unknown>)?.[p];
    return (e as { message?: string })?.message;
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Hlavička faktúry</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Dodávateľ *</Label>
            <Select
              items={Object.fromEntries(dodavatelia.map((d) => [d.id, d.name]))}
              value={form.watch("supplierId")}
              onValueChange={(v) => form.setValue("supplierId", v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Vyber dodávateľa" />
              </SelectTrigger>
              <SelectContent>
                {dodavatelia.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chyba("supplierId") && (
              <p className="text-sm text-destructive">{chyba("supplierId")}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invoiceNumber">Číslo faktúry *</Label>
            <Input id="invoiceNumber" {...form.register("invoiceNumber")} />
            {chyba("invoiceNumber") && (
              <p className="text-sm text-destructive">{chyba("invoiceNumber")}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issueDate">Dátum vystavenia</Label>
            <Input id="issueDate" type="date" {...form.register("issueDate")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deliveryDate">Dátum dodania</Label>
            <Input id="deliveryDate" type="date" {...form.register("deliveryDate")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dueDate">Dátum splatnosti *</Label>
            <Input id="dueDate" type="date" {...form.register("dueDate")} />
            {chyba("dueDate") && (
              <p className="text-sm text-destructive">{chyba("dueDate")}</p>
            )}
          </div>
          <div />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sumaNetEur">Suma bez DPH (€) *</Label>
            <Input id="sumaNetEur" placeholder="1 234,56" {...form.register("sumaNetEur")} />
            {chyba("sumaNetEur") && (
              <p className="text-sm text-destructive">{chyba("sumaNetEur")}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sumaVatEur">DPH (€) *</Label>
            <Input id="sumaVatEur" placeholder="246,91" {...form.register("sumaVatEur")} />
            {chyba("sumaVatEur") && (
              <p className="text-sm text-destructive">{chyba("sumaVatEur")}</p>
            )}
          </div>

          <div className="col-span-2 text-sm text-muted-foreground">
            Suma s DPH:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {netCents !== null && vatCents !== null
                ? formatCentsToEur(netCents + vatCents)
                : "—"}
            </span>
          </div>

          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="note">Poznámka</Label>
            <Input id="note" {...form.register("note")} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Položky (kategorizácia + stredisko)</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              append({
                description: "",
                category: "material",
                costCenterId: "",
                sumaNetEur: "",
              })
            }
          >
            <Plus className="h-4 w-4" /> Pridať položku
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {fields.map((field, i) => (
            <div key={field.id} className="grid grid-cols-[1fr_10rem_10rem_8rem_2.5rem] items-start gap-2">
              <div className="flex flex-col gap-1">
                <Input
                  placeholder="Popis položky"
                  {...form.register(`polozky.${i}.description`)}
                />
                {chyba(`polozky.${i}.description`) && (
                  <p className="text-xs text-destructive">
                    {chyba(`polozky.${i}.description`)}
                  </p>
                )}
              </div>
              <Select
                items={KATEGORIE_FAKTUR}
                value={form.watch(`polozky.${i}.category`)}
                onValueChange={(v) =>
                  form.setValue(
                    `polozky.${i}.category`,
                    v as FormValues["polozky"][number]["category"],
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Kategória" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KATEGORIE_FAKTUR).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-col gap-1">
                <Select
                  items={Object.fromEntries(strediska.map((s) => [s.id, s.name]))}
                  value={form.watch(`polozky.${i}.costCenterId`)}
                  onValueChange={(v) =>
                    form.setValue(`polozky.${i}.costCenterId`, v ?? "")
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Stredisko" />
                  </SelectTrigger>
                  <SelectContent>
                    {strediska.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chyba(`polozky.${i}.costCenterId`) && (
                  <p className="text-xs text-destructive">
                    {chyba(`polozky.${i}.costCenterId`)}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Input
                  placeholder="Suma bez DPH"
                  className="text-right"
                  {...form.register(`polozky.${i}.sumaNetEur`)}
                />
                {chyba(`polozky.${i}.sumaNetEur`) && (
                  <p className="text-xs text-destructive">
                    {chyba(`polozky.${i}.sumaNetEur`)}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Odstrániť položku"
                disabled={fields.length === 1}
                onClick={() => remove(i)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <div
            className={
              polozkySedia
                ? "text-sm text-emerald-600"
                : "text-sm font-medium text-destructive"
            }
          >
            Súčet položiek: {formatCentsToEur(sumaPoloziek)}
            {netCents !== null && !polozkySedia && (
              <> — nesedí so sumou bez DPH ({formatCentsToEur(netCents)})</>
            )}
            {polozkySedia && " ✓"}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Ukladám…" : "Zaevidovať faktúru"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Zrušiť
        </Button>
      </div>
    </form>
  );
}
