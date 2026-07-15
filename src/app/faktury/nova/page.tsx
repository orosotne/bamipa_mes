import { asc, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { listSuppliers } from "@/server/suppliers/service";
import { InvoiceForm } from "./invoice-form";

export const dynamic = "force-dynamic";

export default async function NovaFakturaPage() {
  const [dodavatelia, strediska] = await Promise.all([
    listSuppliers(db),
    db
      .select({ id: schema.costCenters.id, name: schema.costCenters.name })
      .from(schema.costCenters)
      .where(isNull(schema.costCenters.deletedAt))
      .orderBy(asc(schema.costCenters.name)),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Nová faktúra</h1>
      <InvoiceForm
        dodavatelia={dodavatelia.map((d) => ({ id: d.id, name: d.name }))}
        strediska={strediska}
      />
    </div>
  );
}
