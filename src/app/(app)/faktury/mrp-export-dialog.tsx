"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Predchádzajúci mesiac k dnešku (RRRR-MM) — export sa robí po skončení mesiaca. */
function predchadzajuciMesiac(dnes: string): string {
  const rok = Number(dnes.slice(0, 4));
  const mesiac = Number(dnes.slice(5, 7));
  return mesiac === 1
    ? `${rok - 1}-12`
    : `${rok}-${String(mesiac - 1).padStart(2, "0")}`;
}

export function MrpExportDialog({
  dnes,
  trigger,
}: {
  dnes: string;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const mesiac = String(formData.get("mesiac") ?? "");
      const aj = formData.get("ajExportovane") === "on" ? "&aj_exportovane=1" : "";
      const res = await fetch(
        `/api/export/mrp?mesiac=${encodeURIComponent(mesiac)}${aj}`,
        { method: "POST" },
      );
      // Vypršaná session: fetch nasleduje redirect na /login a vráti HTML 200
      // — bez tejto kontroly by sa HTML uložilo ako .xml s úspešným toastom.
      if (res.redirected || !(res.headers.get("content-type") ?? "").includes("xml")) {
        toast.error(
          res.redirected
            ? "Prihlásenie vypršalo — obnov stránku a prihlás sa znova."
            : await res.text(),
        );
        return;
      }
      if (!res.ok) {
        toast.error(await res.text());
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mrp-fakturyp-${mesiac}.xml`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export do MRP stiahnutý — súbor naimportuje účtovníčka.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Export do MRP</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Stiahne XML 2.0 súbor s došlými faktúrami za zvolený mesiac
          (nákladový mesiac faktúry). Faktúry sa označia ako exportované.
        </p>
        <form action={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mesiac">Mesiac *</Label>
            <Input
              id="mesiac"
              name="mesiac"
              type="month"
              defaultValue={predchadzajuciMesiac(dnes)}
              required
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="ajExportovane" className="h-4 w-4" />
            Zahrnúť aj už exportované faktúry
          </label>
          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? "Exportujem…" : "Stiahnuť XML pre MRP"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
