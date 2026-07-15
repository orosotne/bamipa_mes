"use client";

// Plán vs. skutočnosť navážky (M4). Vstupy predvyplnené zostávajúcim
// množstvom (plán − už vydané), aby opätovné otvorenie po čiastočnom výdaji
// neponúklo dvojité vydanie. Draft v localStorage (D8 — nestratiť rozpísaný
// záznam pri prerušenej dávke).
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCentsToEur, formatPriceToEurPerUnit, zobrazQty } from "@/lib/format";
import { useFormDraft } from "@/lib/use-form-draft";
import { stornoVydajaBatchAction, vydajNavazkuAction } from "../actions";

type PlanPolozka = { materialId: string; materialCode: string; materialName: string; qtyKg: string };
type SkutocnaPolozka = { materialId: string; skutQtyKg: string };
type Pohyb = {
  id: string;
  materialCode: string;
  materialName: string;
  moveType: string;
  qtyDelta: string;
  unitPrice: string;
  createdAt: string | Date;
};

function odpocitajQty(planKg: string, skutKg: string): string {
  const zostava = Number(planKg) - Number(skutKg);
  return zostava > 0 ? zostava.toFixed(3) : "0";
}

/**
 * qty(numeric(12,3)) × price(numeric(14,4), centy) → centy, bez floatov.
 * Rovnaká škálovaná bigint technika ako server/inventory/money.ts — tá sa
 * sem needá importovať (server modul do "use client" komponentu), preto
 * lokálna kópia pre jediné miesto zobrazenia riadkového nákladu.
 */
function nakladRiadkuCents(qty: string, price: string): number {
  const qtyScaled = BigInt(qty.replace(".", ""));
  const priceScaled = BigInt(price.replace(".", ""));
  const raw = qtyScaled * priceScaled; // × 10^7 (centy)
  const scale = 10_000_000n;
  const centy = raw < 0n ? -((-raw * 2n + scale) / (2n * scale)) : (raw * 2n + scale) / (2n * scale);
  return Number(centy);
}

export function NavazkaSection({
  batchId,
  planPolozky,
  skutocnePolozky,
  pohyby,
  editable,
}: {
  batchId: string;
  planPolozky: PlanPolozka[];
  skutocnePolozky: SkutocnaPolozka[];
  pohyby: Pohyb[];
  editable: boolean;
}) {
  const skutMap = new Map(skutocnePolozky.map((s) => [s.materialId, s.skutQtyKg]));
  const zostavajuce = useMemo(
    () =>
      Object.fromEntries(
        planPolozky.map((p) => [
          p.materialId,
          odpocitajQty(p.qtyKg, skutMap.get(p.materialId) ?? "0"),
        ]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planPolozky, skutocnePolozky],
  );

  const [vstupy, setVstupy, clearVstupy] = useFormDraft<Record<string, string>>(
    `bamipa:vyroba:${batchId}:navazka`,
    zostavajuce,
  );
  const [pending, startTransition] = useTransition();
  const [stornujeSa, setStornujeSa] = useState<string | null>(null);

  function odovzdajNavazku() {
    const polozky = planPolozky
      .map((p) => ({ materialId: p.materialId, qty: vstupy[p.materialId] ?? "0" }))
      .filter((p) => Number(p.qty) > 0);

    if (polozky.length === 0) {
      toast.error("Zadaj aspoň jedno nenulové množstvo.");
      return;
    }

    startTransition(async () => {
      const vysledok = await vydajNavazkuAction({ batchId, polozky });
      if (vysledok.ok) {
        toast.success("Navážka vydaná zo skladu.");
        // Reset na "0", NIE na znova dopočítané zostávajúce množstvo — to by
        // pri čiastočnom výdaji mohlo pred prekreslením ukázať zastaraný
        // (predchádzajúci) zostatok a zviesť k omylnému opätovnému vydaniu.
        clearVstupy(
          Object.fromEntries(planPolozky.map((p) => [p.materialId, "0"])),
        );
      } else {
        toast.error(vysledok.error);
      }
    });
  }

  function storno(moveId: string) {
    setStornujeSa(moveId);
    startTransition(async () => {
      const vysledok = await stornoVydajaBatchAction({ moveId, batchId });
      if (vysledok.ok) {
        toast.success("Výdaj stornovaný.");
      } else {
        toast.error(vysledok.error);
      }
      setStornujeSa(null);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Navážka — plán vs. skutočnosť</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Materiál</TableHead>
              <TableHead className="text-right">Plán (kg)</TableHead>
              <TableHead className="text-right">Vydané (kg)</TableHead>
              {editable && <TableHead className="text-right">Vydať teraz (kg)</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {planPolozky.map((p) => (
              <TableRow key={p.materialId}>
                <TableCell>
                  <span className="font-medium">{p.materialCode}</span>{" "}
                  <span className="text-muted-foreground">{p.materialName}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{zobrazQty(p.qtyKg)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {zobrazQty(skutMap.get(p.materialId) ?? "0")}
                </TableCell>
                {editable && (
                  <TableCell className="text-right">
                    <Input
                      className="ml-auto h-11 w-28 text-right text-base"
                      value={vstupy[p.materialId] ?? "0"}
                      onChange={(e) =>
                        setVstupy({ ...vstupy, [p.materialId]: e.target.value })
                      }
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {editable && (
          <Button size="lg" className="h-14 self-start text-base" disabled={pending} onClick={odovzdajNavazku}>
            {pending ? "Vydávam…" : "Vydať zo skladu"}
          </Button>
        )}

        {pohyby.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">
              Skutočné výdaje (traceabilita)
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Materiál</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead className="text-right">Množstvo</TableHead>
                  <TableHead className="text-right">Cena</TableHead>
                  <TableHead className="text-right">Náklad</TableHead>
                  {editable && <TableHead className="w-20" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pohyby.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.materialCode} — {p.materialName}
                    </TableCell>
                    <TableCell>{p.moveType === "vydaj" ? "Výdaj" : "Korekcia"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {zobrazQty(p.qtyDelta.replace("-", ""))} kg
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPriceToEurPerUnit(p.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCentsToEur(
                        nakladRiadkuCents(p.qtyDelta.replace("-", ""), p.unitPrice),
                      )}
                    </TableCell>
                    {editable && p.moveType === "vydaj" && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending && stornujeSa === p.id}
                          onClick={() => storno(p.id)}
                        >
                          Storno
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
