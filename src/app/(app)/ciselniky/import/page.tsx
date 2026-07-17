import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Import číselníkov z CSV
          </h1>
          <p className="text-sm text-muted-foreground">
            Šablóny sú v repozitári v <code>docs/import-sablony/</code>. Poradie
            importu: dodávatelia → materiály → receptúry → artikle. Najprv sa
            súbor skontroluje (nič sa nezapíše), import sa spúšťa až po kontrole
            bez chýb.
          </p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href="/ciselniky" />}>
          <ArrowLeft className="h-4 w-4" /> Číselníky
        </Button>
      </div>

      <ImportForm />
    </div>
  );
}
