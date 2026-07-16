import { and, asc, eq, isNull } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { formatCentsToEur, formatDatum, zobrazQty } from "@/lib/format";
import { ZMENY, type Zmena } from "@/lib/enums";
import { detailDavky } from "@/server/batches/queries";
import { aktivnaUprava } from "@/server/lab/queries";
import { listMaterials } from "@/server/materials/service";
import { listWorkers } from "@/server/workers/service";
import { BatchStatusBadge } from "../batch-status-badge";
import { CasySection } from "./casy-section";
import { NavazkaSection } from "./navazka-section";
import { PracaSection } from "./praca-section";
import { PrestojeSection } from "./prestoje-section";
import { ReworkSection } from "./rework-section";
import { SubmitToLabDialog } from "./submit-to-lab-dialog";

export const dynamic = "force-dynamic";

export default async function DavkaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof detailDavky>>;
  try {
    detail = await detailDavky(db, id);
  } catch {
    notFound();
  }

  const [dovody, pracovnici, materialy, uprava] = await Promise.all([
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
    listWorkers(db),
    listMaterials(db),
    aktivnaUprava(db, id),
  ]);

  const editable = detail.davka.status === "rozpracovana";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Späť na výrobu"
          nativeButton={false}
          render={<Link href="/vyroba" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex flex-1 items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {detail.davka.batchNumber}
          </h1>
          <BatchStatusBadge stav={detail.davka.status} />
        </div>
      </div>

      {!editable && detail.davka.status !== "zamietnuta" && (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {detail.davka.status === "caka_na_labak" &&
            "Dávka čaká na vyhodnotenie labákom — záznam je uzamknutý."}
          {detail.davka.status === "schvalena" &&
            "Dávka bola schválená labákom."}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Základné údaje</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Zmes</div>
            <div className="font-medium">
              {detail.mixtureCode} — {detail.mixtureName}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Verzia receptu</div>
            <div className="font-medium">v{detail.recipeVersion}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Násobok dávky</div>
            <div className="font-medium">{zobrazQty(detail.davka.scaleFactor)}×</div>
          </div>
          <div>
            <div className="text-muted-foreground">Dátum výroby</div>
            <div className="font-medium">{formatDatum(detail.davka.productionDate)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Zmena</div>
            <div className="font-medium">
              {ZMENY[detail.davka.shift as Zmena] ?? detail.davka.shift}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Stroj</div>
            <div className="font-medium">{detail.machineName}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Obsluha</div>
            <div className="font-medium">{detail.leadWorkerName}</div>
          </div>
          {detail.davka.outputKg && (
            <div>
              <div className="text-muted-foreground">Skutočná výroba</div>
              <div className="font-medium">{zobrazQty(detail.davka.outputKg)} kg</div>
            </div>
          )}
        </CardContent>
      </Card>

      <NavazkaSection
        batchId={id}
        planPolozky={detail.planKalkulacia.polozky}
        skutocnePolozky={detail.skutocnePolozky}
        pohyby={detail.pohyby}
        editable={editable}
      />

      <PracaSection
        batchId={id}
        praca={detail.praca}
        pracovnici={pracovnici}
        productionDate={detail.davka.productionDate}
        editable={editable}
      />

      <PrestojeSection
        batchId={id}
        prestoje={detail.prestoje}
        dovody={dovody}
        editable={editable}
      />

      <CasySection
        batchId={id}
        workMinutes={detail.davka.workMinutes}
        editable={editable}
      />

      {detail.naklady && (
        <Card>
          <CardHeader>
            <CardTitle>Náklad dávky</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Materiál</span>
              <span className="tabular-nums">{formatCentsToEur(detail.naklady.materialCents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Práca</span>
              <span className="tabular-nums">{formatCentsToEur(detail.naklady.laborCents)}</span>
            </div>
            {(detail.naklady.reworkMaterialCents > 0 || detail.naklady.reworkLaborCents > 0) && (
              <div className="flex justify-between text-amber-600">
                <span>z toho vícenáklady úprav (rework)</span>
                <span className="tabular-nums">
                  {formatCentsToEur(
                    detail.naklady.reworkMaterialCents + detail.naklady.reworkLaborCents,
                  )}
                </span>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t pt-1.5 font-semibold">
              <span>Spolu priame</span>
              <span className="tabular-nums">{formatCentsToEur(detail.naklady.totalCents)}</span>
            </div>
            {detail.naklady.costPerKgCents !== null && (
              <div className="flex justify-between text-muted-foreground">
                <span>Priamy náklad na 1 kg</span>
                <span className="tabular-nums">
                  {formatCentsToEur(Math.round(detail.naklady.costPerKgCents))}/kg
                </span>
              </div>
            )}
            {detail.naklady.fullTotalCents !== null ? (
              <>
                <div className="mt-2 flex justify-between border-t pt-1.5">
                  <span className="text-muted-foreground">Réžia valcovne (uzávierka)</span>
                  <span className="tabular-nums">
                    {formatCentsToEur(detail.naklady.valcovnaOverheadCents ?? 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Labák (prirážka)</span>
                  <span className="tabular-nums">
                    {formatCentsToEur(detail.naklady.labakOverheadCents ?? 0)}
                  </span>
                </div>
                <div className="mt-1 flex justify-between border-t pt-1.5 font-semibold">
                  <span>Plný náklad</span>
                  <span className="tabular-nums">
                    {formatCentsToEur(detail.naklady.fullTotalCents)}
                  </span>
                </div>
                {detail.naklady.fullCostPerKgCents !== null && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Plný náklad na 1 kg</span>
                    <span className="tabular-nums">
                      {formatCentsToEur(Math.round(detail.naklady.fullCostPerKgCents))}/kg
                    </span>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-2 border-t pt-1.5 text-xs text-muted-foreground">
                Réžie a plný náklad sa doplnia po mesačnej uzávierke
                (Kalkulácie).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {editable && <SubmitToLabDialog batchId={id} />}

      {detail.davka.status === "zamietnuta" && uprava && (
        <ReworkSection
          batchId={id}
          adjustmentId={uprava.adjustment.id}
          instrukcia={uprava.adjustment.description}
          triggeredBySequenceNo={uprava.triggeredBySequenceNo}
          vydaje={uprava.vydaje}
          praca={uprava.praca}
          materialy={materialy}
          pracovnici={pracovnici}
          productionDate={detail.davka.productionDate}
        />
      )}
    </div>
  );
}
