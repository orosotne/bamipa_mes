import { asc, isNull } from "drizzle-orm";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
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
import { formatCentsToEur, zobrazQty } from "@/lib/format";
import { zoznamArtiklov } from "@/server/press/queries";
import { getCurrentUser } from "@/server/session";
import { ArticleDialog } from "./article-dialog";
import { DeleteArticleButton } from "./delete-article-button";

export const dynamic = "force-dynamic";

export default async function ArtiklePage() {
  const [artikle, zmesi, user] = await Promise.all([
    zoznamArtiklov(db),
    db
      .select({
        id: schema.mixtures.id,
        code: schema.mixtures.code,
        name: schema.mixtures.name,
      })
      .from(schema.mixtures)
      .where(isNull(schema.mixtures.deletedAt))
      .orderBy(asc(schema.mixtures.code)),
    getCurrentUser(db),
  ]);
  // Predajná cena artikla je citlivý údaj — mutácie len admin (actions to
  // vynucujú tiež); majster lisovne katalóg len číta.
  const canEdit = user.role === "admin";

  return (
    <div className="mx-auto max-w-5xl">
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
            <h1 className="text-2xl font-semibold tracking-tight">
              Katalóg artiklov
            </h1>
            <p className="text-sm text-muted-foreground">
              Modely podošiev: zmes, norma spotreby na pár, predajná cena.
              Jednotka = pár (D7).
            </p>
          </div>
        </div>
        {canEdit && (
          <ArticleDialog
            zmesi={zmesi.map((z) => ({ id: z.id, code: z.code, name: z.name }))}
            trigger={
              <Button size="lg">
                <Plus className="h-4 w-4" /> Nový artikel
              </Button>
            }
          />
        )}
      </div>

      {artikle.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Zatiaľ žiadne artikle{canEdit ? " — začni tlačidlom „Nový artikel“." : "."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kód</TableHead>
                <TableHead>Model podošvy</TableHead>
                <TableHead>Zmes</TableHead>
                <TableHead className="text-right">Norma kg/pár</TableHead>
                <TableHead className="text-right">Cieľový cyklus</TableHead>
                <TableHead className="text-right">Predajná cena</TableHead>
                <TableHead>Stav</TableHead>
                {canEdit && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {artikle.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.code}</TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell>
                    {a.zmesCode} — {a.zmesName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {zobrazQty(a.mixtureKgPerPair)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {a.targetCycleSeconds ? `${a.targetCycleSeconds} s` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {a.salePriceCents !== null
                      ? formatCentsToEur(a.salePriceCents)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {a.isActive ? (
                      <Badge>Aktívny</Badge>
                    ) : (
                      <Badge variant="secondary">Vyradený</Badge>
                    )}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <ArticleDialog
                          artikel={{
                            id: a.id,
                            code: a.code,
                            name: a.name,
                            mixtureId: a.mixtureId,
                            mixtureKgPerPair: a.mixtureKgPerPair,
                            targetCycleSeconds: a.targetCycleSeconds,
                            salePriceCents: a.salePriceCents,
                            isActive: a.isActive,
                          }}
                          zmesi={zmesi.map((z) => ({
                            id: z.id,
                            code: z.code,
                            name: z.name,
                          }))}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Upraviť ${a.code}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DeleteArticleButton id={a.id} nazov={a.code}>
                          <Trash2 className="h-4 w-4" />
                        </DeleteArticleButton>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
