import { db } from "@/db";
import { listMachines } from "@/server/machines/service";
import { zoznamZmesi } from "@/server/mixtures/queries";
import { dnesnyDatum } from "@/server/session";
import { listWorkers } from "@/server/workers/service";
import { BatchForm } from "./batch-form";

export const dynamic = "force-dynamic";

export default async function NovaDavkaPage() {
  const [vsetkyZmesi, stroje, pracovnici] = await Promise.all([
    zoznamZmesi(db),
    listMachines(db),
    listWorkers(db),
  ]);

  // Len zmesi s aktívnou verziou receptu — bez nej sa dávka nedá založiť.
  const zmesi = vsetkyZmesi.filter((z) => z.aktivnaVerzia !== null);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Nová dávka</h1>
        <p className="text-sm text-muted-foreground">
          Založenie výrobnej dávky z aktívnej verzie receptu zmesi.
        </p>
      </div>
      <BatchForm
        zmesi={zmesi}
        stroje={stroje}
        pracovnici={pracovnici}
        dnes={dnesnyDatum()}
      />
    </div>
  );
}
