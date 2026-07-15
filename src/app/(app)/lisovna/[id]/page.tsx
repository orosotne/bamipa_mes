import { and, asc, eq, isNull } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatDatum, zobrazQty } from "@/lib/format";
import { VETVY_PRIPRAVY, type VetvaPripravy } from "@/lib/enums";
import {
  detailPrikazu,
  dostupneDavkyPreArtikel,
} from "@/server/press/queries";
import { dnesnyDatum } from "@/server/session";
import { listWorkers } from "@/server/workers/service";
import { WorkOrderStatusBadge } from "../work-order-status-badge";
import { OrderActions } from "./order-actions";
import { OrezSection } from "./orez-section";
import { PracaSection } from "./praca-section";
import { VykonySection } from "./vykony-section";

export const dynamic = "force-dynamic";

export default async function PrikazDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof detailPrikazu>>;
  try {
    detail = await detailPrikazu(db, id);
  } catch {
    notFound();
  }

  const [lisy, davky, pracovnici, dovodyNepodarkov, dovodyPrestojov] =
    await Promise.all([
      db
        .select({ id: schema.machines.id, code: schema.machines.code, name: schema.machines.name })
        .from(schema.machines)
        .innerJoin(
          schema.costCenters,
          eq(schema.costCenters.id, schema.machines.costCenterId),
        )
        .where(
          and(
            eq(schema.costCenters.code, "lisovna"),
            eq(schema.machines.isActive, true),
            isNull(schema.machines.deletedAt),
          ),
        )
        .orderBy(asc(schema.machines.code)),
      dostupneDavkyPreArtikel(db, detail.artikel.id),
      listWorkers(db),
      db
        .select({ id: schema.defectReasons.id, name: schema.defectReasons.name })
        .from(schema.defectReasons)
        .where(
          and(
            isNull(schema.defectReasons.deletedAt),
            eq(schema.defectReasons.isActive, true),
          ),
        )
        .orderBy(asc(schema.defectReasons.name)),
      db
        .select({ id: schema.downtimeReasons.id, name: schema.downtimeReasons.name })
        .from(schema.downtimeReasons)
        .where(
          and(
            isNull(schema.downtimeReasons.deletedAt),
            eq(schema.downtimeReasons.isActive, true),
          ),
        )
        .orderBy(asc(schema.downtimeReasons.name)),
    ]);

  const editable =
    detail.prikaz.status === "nova" || detail.prikaz.status === "vo_vyrobe";
  const nepodarkovost =
    detail.suhrn.vyrobenePary + detail.suhrn.nepodarkyPary > 0
      ? (detail.suhrn.nepodarkyPary /
          (detail.suhrn.vyrobenePary + detail.suhrn.nepodarkyPary)) *
        100
      : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
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
        <div className="flex flex-1 items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {detail.prikaz.orderNumber}
          </h1>
          <WorkOrderStatusBadge stav={detail.prikaz.status} />
        </div>
        <OrderActions
          workOrderId={id}
          status={detail.prikaz.status}
          maVyrobu={detail.vykony.length > 0}
        />
      </div>

      {detail.prikaz.status === "dokoncena" && (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Príkaz je dokončený — záznamy sú uzamknuté. Na opravy ho znovu otvor.
        </div>
      )}
      {detail.prikaz.status === "zrusena" && (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Príkaz bol zrušený.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Základné údaje</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Artikel</div>
            <div className="font-medium">
              {detail.artikel.code} — {detail.artikel.name}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Zmes</div>
            <div className="font-medium">
              {detail.artikel.zmesCode} — {detail.artikel.zmesName}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Norma zmesi na pár</div>
            <div className="font-medium">
              {zobrazQty(detail.artikel.mixtureKgPerPair)} kg
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Vetva prípravy</div>
            <div className="font-medium">
              {detail.prikaz.prepBranch
                ? VETVY_PRIPRAVY[detail.prikaz.prepBranch as VetvaPripravy]
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Založený</div>
            <div className="font-medium">
              {/* SPEC §6: Europe/Bratislava — toISOString by dal UTC deň. */}
              {formatDatum(
                detail.prikaz.createdAt.toLocaleDateString("en-CA", {
                  timeZone: "Europe/Bratislava",
                }),
              )}
            </div>
          </div>
          {detail.prikaz.note && (
            <div>
              <div className="text-muted-foreground">Poznámka</div>
              <div className="font-medium">{detail.prikaz.note}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Súhrn výroby</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">Plán párov</div>
            <div className="text-lg font-semibold tabular-nums">
              {detail.prikaz.qtyPairsPlanned}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Vyrobené (dobré)</div>
            <div className="text-lg font-semibold tabular-nums">
              {detail.suhrn.vyrobenePary}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Nepodarky</div>
            <div className="text-lg font-semibold tabular-nums">
              {detail.suhrn.nepodarkyPary}
              {nepodarkovost !== null && (
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  ({nepodarkovost.toLocaleString("sk-SK", { maximumFractionDigits: 1 })} %)
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Lisovacie cykly</div>
            <div className="text-lg font-semibold tabular-nums">
              {detail.suhrn.cykly}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Orez / pretoky</div>
            <div className="text-lg font-semibold tabular-nums">
              {zobrazQty(detail.suhrn.orezKg)} kg
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Expedované</div>
            <div className="text-lg font-semibold tabular-nums">
              {detail.suhrn.expedovanePary}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Hotové na sklade</div>
            <div className="text-lg font-semibold tabular-nums">
              {detail.suhrn.hotoveNaSklade}
            </div>
          </div>
        </CardContent>
      </Card>

      <VykonySection
        workOrderId={id}
        vykony={detail.vykony.map((v) => ({
          id: v.id,
          runDate: v.runDate,
          shift: v.shift,
          machineCode: v.machineCode,
          davkaCislo: v.davkaCislo,
          batchId: v.batchId,
          cyclesCount: v.cyclesCount,
          pairsProduced: v.pairsProduced,
          mixtureKg: v.mixtureKg,
          workerName: v.workerName,
          note: v.note,
          nepodarky: v.nepodarky,
          prestoje: v.prestoje,
        }))}
        lisy={lisy}
        davky={davky}
        pracovnici={pracovnici}
        dovodyNepodarkov={dovodyNepodarkov}
        dovodyPrestojov={dovodyPrestojov}
        dnes={dnesnyDatum()}
        editable={editable}
      />

      <PracaSection
        workOrderId={id}
        praca={detail.prace.map((p) => ({
          id: p.id,
          workerName: p.workerName,
          workDate: p.workDate,
          hours: p.hours,
          hourlyRateCents: p.hourlyRateCents,
        }))}
        pracovnici={pracovnici}
        dnes={dnesnyDatum()}
        editable={editable}
      />

      <OrezSection
        workOrderId={id}
        orezy={detail.orezy.map((o) => ({
          id: o.id,
          qtyKg: o.qtyKg,
          recordDate: o.recordDate,
          note: o.note,
        }))}
        dnes={dnesnyDatum()}
        editable={editable}
      />

      <Card>
        <CardHeader>
          <CardTitle>Expedícia</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.expedicie.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Z príkazu zatiaľ nebolo nič expedované.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dodací list</TableHead>
                  <TableHead>Dátum</TableHead>
                  <TableHead className="text-right">Páry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.expedicie.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link
                        href={`/lisovna/expedicia/${e.shipmentId}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {e.shipmentNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDatum(e.shipDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.qtyPairs}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
