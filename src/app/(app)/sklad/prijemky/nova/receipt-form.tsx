"use client";

// Nová príjemka (M2): zdroj faktúra/počiatočný stav, predvyplnenie položiek
// z materiálových položiek faktúry (cena = dokladový zdroj, editovateľná).
import { FileDown, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { formatPriceToEurPerUnit, zobrazQty } from "@/lib/format";
import { vytvorPrijemkuAction } from "../../actions";

type Material = { id: string; code: string; name: string; unit: string };
type FakturaNaVyber = {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  maPrijemku: boolean;
  polozky: {
    id: string;
    description: string;
    qty: string | null;
    unit: string | null;
    unitPrice: string | null;
  }[];
};

type Riadok = {
  key: number;
  materialId: string;
  qty: string;
  cenaEur: string;
  supplierLotCode: string;
  /** väzba na riadok faktúry pri predvyplnení (traceabilita šarža → položka FA) */
  invoiceItemId?: string;
  popisZFaktury?: string;
};

let dalsiKey = 1;
function novyRiadok(): Riadok {
  return { key: dalsiKey++, materialId: "", qty: "", cenaEur: "", supplierLotCode: "" };
}

/** "42.5000" (centy) → "0,425" (€ na predvyplnenie inputu). */
function cenaNaInput(price: string | null): string {
  if (!price) return "";
  return formatPriceToEurPerUnit(price).replace(/[\s  ]?€$/, "");
}

export function ReceiptForm({
  materialy,
  faktury,
  dnes,
}: {
  materialy: Material[];
  faktury: FakturaNaVyber[];
  dnes: string;
}) {
  const [source, setSource] = useState<"faktura" | "pociatocny_stav">("faktura");
  const [invoiceId, setInvoiceId] = useState("");
  const [riadky, setRiadky] = useState<Riadok[]>([novyRiadok()]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const vybranaFaktura = faktury.find((f) => f.id === invoiceId);

  function predvyplnZFaktury() {
    if (!vybranaFaktura) return;
    setRiadky(
      vybranaFaktura.polozky.map((p) => ({
        key: dalsiKey++,
        materialId: "",
        qty: p.qty ? zobrazQty(p.qty) : "",
        cenaEur: cenaNaInput(p.unitPrice),
        supplierLotCode: "",
        invoiceItemId: p.id,
        popisZFaktury: p.description,
      })),
    );
    toast.info(
      `Predvyplnené ${vybranaFaktura.polozky.length} položiek — vyber materiál pre každý riadok.`,
    );
  }

  function uprav(key: number, zmena: Partial<Riadok>) {
    setRiadky((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...zmena } : r)),
    );
  }

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const vysledok = await vytvorPrijemkuAction({
        source,
        invoiceId: source === "faktura" ? invoiceId || undefined : undefined,
        receivedAt: String(formData.get("receivedAt") ?? ""),
        note: String(formData.get("note") ?? ""),
        polozky: riadky.map((r) => ({
          materialId: r.materialId,
          qty: r.qty,
          cenaEur: r.cenaEur,
          supplierLotCode: r.supplierLotCode,
          invoiceItemId: r.invoiceItemId,
        })),
      });
      if (vysledok.ok) {
        toast.success("Príjemka zaevidovaná — šarže sú na sklade.");
        router.push("/sklad/prijemky");
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
          <CardTitle>Hlavička príjemky</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={source === "faktura" ? "default" : "outline"}
              onClick={() => setSource("faktura")}
            >
              Príjem z faktúry
            </Button>
            <Button
              type="button"
              variant={source === "pociatocny_stav" ? "default" : "outline"}
              onClick={() => setSource("pociatocny_stav")}
            >
              Počiatočný stav skladu
            </Button>
          </div>

          {source === "faktura" && (
            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>Faktúra *</Label>
                <Select
                  items={Object.fromEntries(
                    faktury.map((f) => [
                      f.id,
                      `${f.invoiceNumber} — ${f.supplierName}${f.maPrijemku ? " (už prijatá!)" : ""}`,
                    ]),
                  )}
                  value={invoiceId}
                  onValueChange={(v) => setInvoiceId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Vyber faktúru s materiálovými položkami" />
                  </SelectTrigger>
                  <SelectContent>
                    {faktury.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.invoiceNumber} — {f.supplierName}
                        {f.maPrijemku ? " (už prijatá!)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {vybranaFaktura?.maPrijemku && (
                  <p className="text-xs font-medium text-amber-600">
                    ⚠ K tejto faktúre už príjemka existuje — skontroluj, či nejde
                    o duplicitný príjem (čiastočné dodávky sú v poriadku).
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!vybranaFaktura}
                onClick={predvyplnZFaktury}
              >
                <FileDown className="h-4 w-4" /> Predvyplniť položky
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="receivedAt">Dátum príjmu * (FIFO poradie)</Label>
              <Input
                id="receivedAt"
                name="receivedAt"
                type="date"
                defaultValue={dnes}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note">Poznámka</Label>
              <Input id="note" name="note" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Číslo príjemky pridelí systém automaticky (P-RRRR-NNNN).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Položky → šarže</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRiadky((prev) => [...prev, novyRiadok()])}
          >
            <Plus className="h-4 w-4" /> Pridať položku
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {riadky.map((r) => (
            <div key={r.key} className="flex flex-col gap-1">
              {r.popisZFaktury && (
                <p className="text-xs text-muted-foreground">
                  Z faktúry: {r.popisZFaktury}
                </p>
              )}
              <div className="grid grid-cols-[1fr_7rem_8rem_9rem_2.5rem] items-center gap-2">
                <Select
                  items={materialItems}
                  value={r.materialId}
                  onValueChange={(v) => uprav(r.key, { materialId: v ?? "" })}
                >
                  <SelectTrigger>
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
                  placeholder="Množstvo"
                  className="text-right"
                  value={r.qty}
                  onChange={(e) => uprav(r.key, { qty: e.target.value })}
                />
                <Input
                  placeholder="Cena €/MJ"
                  className="text-right"
                  value={r.cenaEur}
                  onChange={(e) => uprav(r.key, { cenaEur: e.target.value })}
                />
                <Input
                  placeholder="Šarža dodávateľa"
                  value={r.supplierLotCode}
                  onChange={(e) =>
                    uprav(r.key, { supplierLotCode: e.target.value })
                  }
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
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Ukladám…" : "Zaevidovať príjemku"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Zrušiť
        </Button>
      </div>
    </form>
  );
}
