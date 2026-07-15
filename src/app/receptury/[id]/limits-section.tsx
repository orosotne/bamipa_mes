"use client";

// M5 Labák — správa tolerančných limitov per zmes. Každý riadok = jeden QC
// parameter s min/max; prázdne obe = limit zrušený. Uloženie per riadok.
import { useState, useTransition } from "react";
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
import { zobrazQty } from "@/lib/format";
import { ulozLimitAction } from "../actions";

type LimitRiadok = {
  parameterId: string;
  code: string;
  name: string;
  unit: string | null;
  minValue: string | null;
  maxValue: string | null;
};

function zobraz(v: string | null): string {
  return v ? zobrazQty(v) : "";
}

export function LimitsSection({
  mixtureId,
  limity,
}: {
  mixtureId: string;
  limity: LimitRiadok[];
}) {
  const [stav, setStav] = useState<Record<string, { min: string; max: string }>>(
    () =>
      Object.fromEntries(
        limity.map((l) => [
          l.parameterId,
          { min: zobraz(l.minValue), max: zobraz(l.maxValue) },
        ]),
      ),
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function uloz(parameterId: string) {
    const riadok = stav[parameterId];
    setPendingId(parameterId);
    startTransition(async () => {
      const r = await ulozLimitAction({
        mixtureId,
        parameterId,
        minValue: riadok.min,
        maxValue: riadok.max,
      });
      if (r.ok) {
        toast.success(
          !riadok.min.trim() && !riadok.max.trim()
            ? "Limit zrušený."
            : "Limit uložený.",
        );
      } else {
        toast.error(r.error);
      }
      setPendingId(null);
    });
  }

  function set(parameterId: string, pole: "min" | "max", value: string) {
    setStav((s) => ({ ...s, [parameterId]: { ...s[parameterId], [pole]: value } }));
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Limity labáku (QC)</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Parameter</TableHead>
              <TableHead className="w-32 text-right">Min</TableHead>
              <TableHead className="w-32 text-right">Max</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {limity.map((l) => (
              <TableRow key={l.parameterId}>
                <TableCell>
                  <span className="font-medium">{l.code}</span>{" "}
                  <span className="text-muted-foreground">{l.name}</span>
                  {l.unit && (
                    <span className="text-muted-foreground"> ({l.unit})</span>
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    inputMode="decimal"
                    className="text-right tabular-nums"
                    placeholder="—"
                    value={stav[l.parameterId]?.min ?? ""}
                    onChange={(e) => set(l.parameterId, "min", e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    inputMode="decimal"
                    className="text-right tabular-nums"
                    placeholder="—"
                    value={stav[l.parameterId]?.max ?? ""}
                    onChange={(e) => set(l.parameterId, "max", e.target.value)}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pendingId === l.parameterId}
                    onClick={() => uloz(l.parameterId)}
                  >
                    {pendingId === l.parameterId ? "…" : "Uložiť"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Prázdne obe polia = limit sa zruší. Bez definovaných limitov sa dávky
          tejto zmesi nedajú merať v labáku.
        </p>
      </CardContent>
    </Card>
  );
}
