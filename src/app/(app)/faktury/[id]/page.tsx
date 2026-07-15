import { asc, eq } from "drizzle-orm";
import { ArrowLeft, CreditCard } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { KATEGORIE_FAKTUR } from "@/lib/enums";
import { formatCentsToEur, formatDatum } from "@/lib/format";
import { dnesnyDatum } from "@/server/session";
import { StatusBadge } from "../status-badge";
import { ApproveButton } from "./approve-button";
import { PaymentDialog } from "./payment-dialog";

export const dynamic = "force-dynamic";

export default async function FakturaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [faktura] = await db
    .select({
      invoice: schema.invoices,
      supplierName: schema.suppliers.name,
    })
    .from(schema.invoices)
    .innerJoin(schema.suppliers, eq(schema.invoices.supplierId, schema.suppliers.id))
    .where(eq(schema.invoices.id, id));

  if (!faktura) notFound();
  const inv = faktura.invoice;

  const [polozky, platby, strediska, prijemky] = await Promise.all([
    db
      .select()
      .from(schema.invoiceItems)
      .where(eq(schema.invoiceItems.invoiceId, id))
      .orderBy(asc(schema.invoiceItems.createdAt)),
    db
      .select()
      .from(schema.invoicePayments)
      .where(eq(schema.invoicePayments.invoiceId, id))
      .orderBy(asc(schema.invoicePayments.paidAt)),
    db.select().from(schema.costCenters),
    // Traceabilita faktúra → sklad (SPEC §7.1): naviazané príjemky.
    db
      .select({
        id: schema.receipts.id,
        receiptNumber: schema.receipts.receiptNumber,
        receivedAt: schema.receipts.receivedAt,
      })
      .from(schema.receipts)
      .where(eq(schema.receipts.invoiceId, id))
      .orderBy(asc(schema.receipts.receivedAt)),
  ]);

  const strediskaMap = new Map(strediska.map((s) => [s.id, s.name]));
  const zaplatene = platby.reduce((s, p) => s + p.amountCents, 0);
  const zostatok = inv.totalGrossCents - zaplatene;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Späť na zoznam"
            nativeButton={false}
            render={<Link href="/faktury" />}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
              Faktúra {inv.invoiceNumber}
              <StatusBadge stav={inv.status} />
            </h1>
            <p className="text-sm text-muted-foreground">{faktura.supplierName}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {inv.status === "nova" && <ApproveButton id={inv.id} />}
          {(inv.status === "schvalena" || inv.status === "ciastocne_zaplatena") && (
            <PaymentDialog
              invoiceId={inv.id}
              dnes={dnesnyDatum()}
              trigger={
                <Button>
                  <CreditCard className="h-4 w-4" /> Pridať platbu
                </Button>
              }
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Suma s DPH
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {formatCentsToEur(inv.totalGrossCents)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Zaplatené
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {formatCentsToEur(zaplatene)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Zostatok
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {formatCentsToEur(zostatok)}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Údaje faktúry</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Dátum vystavenia</span>
            <span>{inv.issueDate ? formatDatum(inv.issueDate) : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Dátum dodania</span>
            <span>{inv.deliveryDate ? formatDatum(inv.deliveryDate) : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Dátum splatnosti</span>
            <span className="font-medium">{formatDatum(inv.dueDate)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Suma bez DPH / DPH</span>
            <span className="tabular-nums">
              {formatCentsToEur(inv.totalNetCents)} / {formatCentsToEur(inv.totalVatCents)}
            </span>
          </div>
          {inv.note && (
            <div className="col-span-2 flex justify-between">
              <span className="text-muted-foreground">Poznámka</span>
              <span>{inv.note}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Položky</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Popis</TableHead>
                <TableHead>Kategória</TableHead>
                <TableHead>Stredisko</TableHead>
                <TableHead className="text-right">Suma bez DPH</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {polozky.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.description}</TableCell>
                  <TableCell>{KATEGORIE_FAKTUR[p.category]}</TableCell>
                  <TableCell>{strediskaMap.get(p.costCenterId) ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCentsToEur(p.totalNetCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Príjemky na sklad</CardTitle>
        </CardHeader>
        <CardContent>
          {prijemky.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Faktúra zatiaľ nebola prijatá na sklad —{" "}
              <Link
                href="/sklad/prijemky/nova"
                className="underline underline-offset-4"
              >
                vytvoriť príjemku
              </Link>
              .
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {prijemky.map((p) => (
                <li key={p.id}>
                  <Link
                    href="/sklad/prijemky"
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {p.receiptNumber}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    — prijaté {formatDatum(p.receivedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Platby</CardTitle>
        </CardHeader>
        <CardContent>
          {platby.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatiaľ žiadne platby.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dátum</TableHead>
                    <TableHead className="text-right">Suma</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {platby.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{formatDatum(p.paidAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCentsToEur(p.amountCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Separator className="my-3" />
              <div className="flex justify-between text-sm font-medium">
                <span>Spolu zaplatené</span>
                <span className="tabular-nums">{formatCentsToEur(zaplatene)}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
