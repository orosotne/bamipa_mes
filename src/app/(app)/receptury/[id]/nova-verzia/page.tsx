import { and, asc, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { detailZmesi } from "@/server/mixtures/queries";
import { VersionForm } from "./version-form";

export const dynamic = "force-dynamic";

export default async function NovaVerziaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ verzia?: string }>;
}) {
  const { id } = await params;
  const { verzia } = await searchParams;

  let detail: Awaited<ReturnType<typeof detailZmesi>>;
  try {
    // Predvypĺňa sa verzia, na ktorú sa používateľ práve pozeral
    // (neplatná/žiadna → aktívna, rieši detailZmesi fallback).
    detail = await detailZmesi(db, id, verzia ? Number(verzia) : undefined);
  } catch {
    notFound();
  }

  // D6: receptúry v kg — ponúkame len materiály vedené v kg.
  const materialy = await db
    .select({
      id: schema.materials.id,
      code: schema.materials.code,
      name: schema.materials.name,
    })
    .from(schema.materials)
    .where(
      and(eq(schema.materials.unit, "kg"), isNull(schema.materials.deletedAt)),
    )
    .orderBy(asc(schema.materials.code));

  const novaVerzia = (detail.verzie[0]?.version ?? 0) + 1;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        Nová verzia receptúry
      </h1>
      <VersionForm
        mixtureId={id}
        mixtureCode={detail.zmes.code}
        novaVerzia={novaVerzia}
        materialy={materialy}
        predvyplnene={
          detail.zvolena?.polozky.map((p) => ({
            materialId: p.materialId,
            qtyKg: p.qtyKg,
          })) ?? []
        }
        stdKg={detail.zvolena?.recipe.standardBatchKg ?? "100.000"}
        techNotes={detail.zvolena?.recipe.techNotes ?? ""}
      />
    </div>
  );
}
