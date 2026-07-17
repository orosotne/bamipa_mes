import { asc, eq, isNull } from "drizzle-orm";
import { CircleDollarSign, Pencil, Plus, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
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
import * as schema from "@/db/schema";
import { formatCentsToEur } from "@/lib/format";
import { dnesnyDatum } from "@/server/session";
import { listSadzby } from "@/server/workers/service";
import { DeleteMachineButton } from "./delete-machine-button";
import { DeleteWorkerButton } from "./delete-worker-button";
import { MachineDialog } from "./machine-dialog";
import { RatesDialog } from "./rates-dialog";
import { WorkerDialog } from "./worker-dialog";

export const dynamic = "force-dynamic";

export default async function CiselnikyPage() {
  const [strediska, stroje, pracovnici] = await Promise.all([
    db
      .select({ id: schema.costCenters.id, name: schema.costCenters.name })
      .from(schema.costCenters)
      .where(isNull(schema.costCenters.deletedAt))
      .orderBy(asc(schema.costCenters.name)),
    db
      .select({
        id: schema.machines.id,
        code: schema.machines.code,
        name: schema.machines.name,
        costCenterId: schema.machines.costCenterId,
        isActive: schema.machines.isActive,
        strediskoName: schema.costCenters.name,
      })
      .from(schema.machines)
      .innerJoin(
        schema.costCenters,
        eq(schema.machines.costCenterId, schema.costCenters.id),
      )
      .where(isNull(schema.machines.deletedAt))
      .orderBy(asc(schema.machines.code)),
    db
      .select()
      .from(schema.workers)
      .where(isNull(schema.workers.deletedAt))
      .orderBy(asc(schema.workers.fullName)),
  ]);

  const dnes = dnesnyDatum();
  const sadzbyPodlaPracovnika = new Map(
    await Promise.all(
      pracovnici.map(
        async (p) => [p.id, await listSadzby(db, p.id)] as const,
      ),
    ),
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Číselníky</h1>
          <p className="text-sm text-muted-foreground">
            Stroje a pracovníci pre výrobné dávky valcovne (M4).
          </p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/ciselniky/import" />}
        >
          <Upload className="h-4 w-4" /> Import CSV
        </Button>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Stroje</h2>
          <MachineDialog
            strediska={strediska}
            trigger={
              <Button>
                <Plus className="h-4 w-4" /> Nový stroj
              </Button>
            }
          />
        </div>
        {stroje.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            Zatiaľ žiadne stroje.
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kód</TableHead>
                  <TableHead>Názov</TableHead>
                  <TableHead>Stredisko</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="w-24 text-right">Akcie</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stroje.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.code}</TableCell>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>{s.strediskoName}</TableCell>
                    <TableCell>
                      {s.isActive ? (
                        <Badge>Aktívny</Badge>
                      ) : (
                        <Badge variant="secondary">Vyradený</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <MachineDialog
                          stroj={s}
                          strediska={strediska}
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label="Upraviť">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DeleteMachineButton id={s.id} nazov={s.name}>
                          <Trash2 className="h-4 w-4" />
                        </DeleteMachineButton>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Pracovníci a sadzby</h2>
          <WorkerDialog
            trigger={
              <Button>
                <Plus className="h-4 w-4" /> Nový pracovník
              </Button>
            }
          />
        </div>
        {pracovnici.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            Zatiaľ žiadni pracovníci.
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Meno</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead>Aktuálna sadzba</TableHead>
                  <TableHead className="w-32 text-right">Akcie</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pracovnici.map((p) => {
                  const sadzby = sadzbyPodlaPracovnika.get(p.id) ?? [];
                  const aktualnaSadzba = sadzby.find((s) => s.validFrom <= dnes);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.fullName}</TableCell>
                      <TableCell>
                        {p.isActive ? (
                          <Badge>Aktívny</Badge>
                        ) : (
                          <Badge variant="secondary">Vyradený</Badge>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {aktualnaSadzba
                          ? `${formatCentsToEur(aktualnaSadzba.hourlyRateCents)}/hod`
                          : "— bez platnej sadzby"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <RatesDialog
                            workerId={p.id}
                            workerName={p.fullName}
                            sadzby={sadzby}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Sadzby ${p.fullName}`}
                              >
                                <CircleDollarSign className="h-4 w-4" />
                              </Button>
                            }
                          />
                          <WorkerDialog
                            pracovnik={p}
                            trigger={
                              <Button variant="ghost" size="icon-sm" aria-label="Upraviť">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            }
                          />
                          <DeleteWorkerButton id={p.id} nazov={p.fullName}>
                            <Trash2 className="h-4 w-4" />
                          </DeleteWorkerButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
