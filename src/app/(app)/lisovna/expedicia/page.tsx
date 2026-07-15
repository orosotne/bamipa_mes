import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { formatDatum } from "@/lib/format";
import { zoznamDodacichListov } from "@/server/press/queries";

export const dynamic = "force-dynamic";

export default async function ExpedíciaPage() {
  const dodacie = await zoznamDodacichListov(db);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Späť na lisovňu"
            nativeButton={false}
            render={<Link href="/lisovna" />}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Expedícia</h1>
            <p className="text-sm text-muted-foreground">
              Dodacie listy hotových výrobkov (páry podošiev).
            </p>
          </div>
        </div>
        <Button
          size="lg"
          nativeButton={false}
          render={<Link href="/lisovna/expedicia/novy" />}
        >
          <Plus className="h-4 w-4" /> Nový dodací list
        </Button>
      </div>

      {dodacie.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Zatiaľ žiadne dodacie listy.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo</TableHead>
                <TableHead>Dátum</TableHead>
                <TableHead>Odberateľ</TableHead>
                <TableHead className="text-right">Položky</TableHead>
                <TableHead className="text-right">Páry spolu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dodacie.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link
                      href={`/lisovna/expedicia/${d.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {d.shipmentNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDatum(d.shipDate)}</TableCell>
                  <TableCell>{d.customer}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {d.polozkyPocet}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {d.paryCelkom}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
