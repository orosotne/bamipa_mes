"use client";

// Dvojkrokový import: 1) Skontrolovať (dry-run, tabuľka chýb po slovensky),
// 2) Importovať — aktívne až po kontrole bez chýb. Zmena súboru/typu/režimu
// kontrolu zneplatní.
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ImportChyba } from "@/server/import/csv";
import type { ImportPrehlad } from "@/server/import/typy";
import { importCsvAction, type ImportTyp } from "./actions";

const TYPY: Record<ImportTyp, string> = {
  dodavatelia: "1 — Dodávatelia",
  materialy: "2 — Materiály",
  receptury: "3 — Receptúry zmesí",
  artikle: "4 — Artikle podošiev",
};

type Kontrola = {
  chyby: ImportChyba[];
  prehlad: ImportPrehlad;
};

export function ImportForm() {
  const [typ, setTyp] = useState<ImportTyp>("dodavatelia");
  const [aktualizovat, setAktualizovat] = useState(false);
  const [subor, setSubor] = useState<File | null>(null);
  const [kontrola, setKontrola] = useState<Kontrola | null>(null);
  const [importHotovy, setImportHotovy] = useState<ImportPrehlad | null>(null);
  const [pending, startTransition] = useTransition();
  // Reset file inputu po úspešnom importe (input je uncontrolled).
  const [inputKey, setInputKey] = useState(0);

  function zneplatniKontrolu() {
    setKontrola(null);
    setImportHotovy(null);
  }

  function spusti(dryRun: boolean) {
    if (!subor) {
      toast.error("Vyber CSV súbor.");
      return;
    }
    const fd = new FormData();
    fd.append("typ", typ);
    fd.append("aktualizovat", String(aktualizovat));
    fd.append("subor", subor);
    startTransition(async () => {
      const vysledok = await importCsvAction(dryRun, fd);
      if (!vysledok.ok) {
        toast.error(vysledok.error);
        return;
      }
      if (dryRun) {
        setImportHotovy(null);
        setKontrola({ chyby: vysledok.chyby, prehlad: vysledok.prehlad });
        if (vysledok.chyby.length === 0) {
          toast.success("Kontrola bez chýb — import je pripravený.");
        } else {
          toast.error(`Kontrola našla ${vysledok.chyby.length} chýb.`);
        }
        return;
      }
      if (vysledok.chyby.length > 0) {
        // Medzi kontrolou a importom sa DB zmenila — ukáž nové chyby.
        setKontrola({ chyby: vysledok.chyby, prehlad: vysledok.prehlad });
        toast.error("Import neprebehol — údaje sa medzičasom zmenili.");
        return;
      }
      setImportHotovy(vysledok.prehlad);
      setKontrola(null);
      setSubor(null);
      setInputKey((k) => k + 1);
      toast.success("Import dokončený.");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-lg border p-4">
        <div className="flex flex-col gap-1.5">
          <Label>Typ číselníka</Label>
          <Select
            items={TYPY}
            value={typ}
            onValueChange={(v) => {
              setTyp((v as ImportTyp) ?? "dodavatelia");
              zneplatniKontrolu();
            }}
          >
            <SelectTrigger className="max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TYPY).map(([hodnota, nazov]) => (
                <SelectItem key={hodnota} value={hodnota}>
                  {nazov}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="subor">CSV súbor</Label>
          <Input
            key={inputKey}
            id="subor"
            type="file"
            accept=".csv,text/csv"
            className="max-w-sm"
            onChange={(e) => {
              setSubor(e.target.files?.[0] ?? null);
              zneplatniKontrolu();
            }}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={aktualizovat}
            onChange={(e) => {
              setAktualizovat(e.target.checked);
              zneplatniKontrolu();
            }}
          />
          Aktualizovať existujúce záznamy (inak sa preskakujú; receptúram vznikne
          nová verzia)
        </label>

        <div className="flex gap-2">
          <Button
            onClick={() => spusti(true)}
            disabled={pending || !subor}
            variant={kontrola && kontrola.chyby.length === 0 ? "outline" : "default"}
          >
            {pending ? "Pracujem…" : "Skontrolovať"}
          </Button>
          {kontrola && kontrola.chyby.length === 0 && (
            <Button onClick={() => spusti(false)} disabled={pending}>
              {pending ? "Importujem…" : "Importovať"}
            </Button>
          )}
        </div>
      </div>

      {kontrola && kontrola.chyby.length === 0 && (
        <div className="flex items-center gap-3 rounded-lg border p-4">
          <span className="text-sm font-medium">Kontrola bez chýb:</span>
          <PrehladBadges prehlad={kontrola.prehlad} />
        </div>
      )}

      {kontrola && kontrola.chyby.length > 0 && (
        <div className="rounded-lg border">
          <div className="border-b p-3 text-sm font-medium text-destructive">
            Chyby v súbore ({kontrola.chyby.length}) — oprav ich v Exceli a nahraj
            súbor znova. Nič sa nezapísalo.
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Riadok</TableHead>
                <TableHead className="w-44">Stĺpec</TableHead>
                <TableHead>Chyba</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kontrola.chyby.map((chyba, i) => (
                <TableRow key={`${chyba.riadok}-${i}`}>
                  <TableCell className="tabular-nums">{chyba.riadok}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {chyba.stlpec ?? "—"}
                  </TableCell>
                  <TableCell>{chyba.sprava}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {importHotovy && (
        <div className="flex items-center gap-3 rounded-lg border p-4">
          <span className="text-sm font-medium">Import dokončený:</span>
          <PrehladBadges prehlad={importHotovy} />
        </div>
      )}
    </div>
  );
}

function PrehladBadges({ prehlad }: { prehlad: ImportPrehlad }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge>{prehlad.novych} nových</Badge>
      <Badge variant="secondary">{prehlad.aktualizovanych} aktualizovaných</Badge>
      <Badge variant="outline">{prehlad.preskocenych} preskočených</Badge>
    </div>
  );
}
